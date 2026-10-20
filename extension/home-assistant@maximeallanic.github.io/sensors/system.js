// System sensors: battery (UPower), CPU, memory, temperature, fan, free disk space (read every 30 s), Wi-Fi and IP
// address (NetworkManager).
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import NM from 'gi://NM';
import {SensorSource, sensor, upowerProxy} from './base.js';
import {parseCpu, cpuPercent, memoryPercent, parseHwmon, round} from './parse.js';
import {_} from '../i18n.js';

const PERIOD = 30;
const HWMON = '/sys/class/hwmon';
const UPOWER_CHARGING = 1;  // UPower Device.State: 1 = charging

function read(path) {
    try {
        return new TextDecoder().decode(GLib.file_get_contents(path)[1]);
    } catch (_e) {
        return null;
    }
}

// Every hwmon device with its temperature and fan files (a few bytes each).
function readHwmonDirs() {
    const dirs = [];
    let dir;
    try {
        dir = GLib.Dir.open(HWMON, 0);
    } catch (_e) {
        return dirs;
    }
    for (let n = dir.read_name(); n !== null; n = dir.read_name()) {
        const path = `${HWMON}/${n}`;
        const files = {};
        try {
            const sub = GLib.Dir.open(path, 0);
            for (let f = sub.read_name(); f !== null; f = sub.read_name()) {
                if (/^(temp\d+_(input|label)|fan\d+_input)$/.test(f))
                    files[f] = read(`${path}/${f}`) ?? '';
            }
            sub.close();
        } catch (_e) {
            // A device that disappeared meanwhile: skipped.
        }
        dirs.push({name: read(`${path}/name`) ?? '', files});
    }
    dir.close();
    return dirs;
}

export const SystemSource = GObject.registerClass(
class SystemSource extends SensorSource {
    // Asynchronous: the companion waits for the end (UPower proxies) before declaring the sensors.
    async start() {
        this._stopped = false;
        const diagnostic = {entity_category: 'diagnostic', state_class: 'measurement'};
        this._cpuBefore = parseCpu(read('/proc/stat'));
        this._declare(sensor('cpu', 'sensor', _('CPU'), 'mdi:cpu-64-bit', {...diagnostic, unit_of_measurement: '%'}),
            this._cpuBefore ? null : '/proc/stat unreadable');
        this._declare(sensor('memory', 'sensor', _('Memory'), 'mdi:memory', {...diagnostic, unit_of_measurement: '%'}));
        const hw = parseHwmon(readHwmonDirs());
        this._declare(sensor('temperature', 'sensor', _('Temperature'), 'mdi:thermometer',
            {...diagnostic, device_class: 'temperature', unit_of_measurement: '°C'}),
        hw.temperature === null ? 'no known processor temperature in hwmon' : null);
        this._declare(sensor('fan', 'sensor', _('Fan'), 'mdi:fan', {...diagnostic, unit_of_measurement: 'rpm'}),
            hw.fan === null ? 'no fan in hwmon' : null);
        this._declare(sensor('free_disk', 'sensor', _('Free disk space'), 'mdi:harddisk',
            {...diagnostic, device_class: 'data_size', unit_of_measurement: 'GB'}));
        this._files();
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, PERIOD, () => {
            this._files();
            this._network();
            return GLib.SOURCE_CONTINUE;
        });

        this._declare(sensor('wifi', 'sensor', _('Wi-Fi network'), 'mdi:wifi', {entity_category: 'diagnostic'}));
        this._declare(sensor('ip_address', 'sensor', _('IP address'), 'mdi:ip-network',
            {entity_category: 'diagnostic'}));
        this._nm = null;
        NM.Client.new_async(null, (_o, res) => {
            try {
                this._nm = NM.Client.new_finish(res);
            } catch (e) {
                console.warn(`[home-assistant] NetworkManager unavailable: ${e.message}`);
                return;
            }
            if (this._stopped)
                return;
            this._nm.connectObject('notify::primary-connection', () => this._network(), this);
            this._network();
        });

        [this._battery, this._upower] = await Promise.all([
            upowerProxy('/org/freedesktop/UPower/devices/DisplayDevice', 'org.freedesktop.UPower.Device'),
            upowerProxy('/org/freedesktop/UPower', 'org.freedesktop.UPower'),
        ]);
        if (this._stopped)
            return;
        const present = this._battery?.get_cached_property('IsPresent')?.unpack() === true;
        const missing = present ? null : 'no battery';
        this._declare(sensor('battery', 'sensor', _('Battery'), 'mdi:battery',
            {device_class: 'battery', unit_of_measurement: '%', state_class: 'measurement'}), missing);
        this._declare(sensor('charging', 'binary_sensor', _('Charging'), 'mdi:battery-charging',
            {device_class: 'battery_charging'}), missing);
        this._declare(sensor('ac_power', 'binary_sensor', _('AC power'), 'mdi:power-plug', {device_class: 'plug'}),
            this._upower ? null : 'UPower not available');
        this._battery?.connectObject('g-properties-changed', () => this._power(), this);
        this._upower?.connectObject('g-properties-changed', () => this._power(), this);
        this._power();
    }

    stop() {
        this._stopped = true;
        if (this._timer)
            GLib.source_remove(this._timer);
        this._timer = 0;
        for (const o of [this._battery, this._upower, this._nm])
            o?.disconnectObject(this);
    }

    _power() {
        const p = name => this._battery?.get_cached_property(name)?.unpack();
        const onBattery = this._upower?.get_cached_property('OnBattery')?.unpack();
        const percent = p('Percentage');
        this._set({
            ...percent !== undefined ? {battery: {state: Math.round(percent)}} : {},
            ...p('State') !== undefined ? {charging: {state: p('State') === UPOWER_CHARGING}} : {},
            ...onBattery !== undefined ? {ac_power: {state: !onBattery}} : {},
        });
    }

    _files() {
        const v = {};
        const cpu = parseCpu(read('/proc/stat'));
        if (cpu && this._cpuBefore) {
            v.cpu = {state: cpuPercent(this._cpuBefore, cpu)};
            this._cpuBefore = cpu;
        }
        const mem = memoryPercent(read('/proc/meminfo'));
        if (mem !== null)
            v.memory = {state: mem};
        const hw = parseHwmon(readHwmonDirs());
        if (hw.temperature !== null)
            v.temperature = {state: hw.temperature};
        if (hw.fan !== null)
            v.fan = {state: hw.fan};
        try {
            // The home directory's file system: where the user's files go.
            const free = Gio.File.new_for_path(GLib.get_home_dir())
                .query_filesystem_info('filesystem::free', null).get_attribute_uint64('filesystem::free');
            v.free_disk = {state: round(free / 1e9, 1)};
        } catch (e) {
            console.warn(`[home-assistant] free disk space: ${e.message}`);
        }
        this._set(v);
    }

    // No Wi-Fi network or no address: null, which HA shows as "unknown".
    _network() {
        if (!this._nm)
            return;
        const c = this._nm.primary_connection ?? null;
        let wifi = null;
        for (const d of c?.get_devices() ?? []) {
            const ap = d instanceof NM.DeviceWifi ? d.get_active_access_point() : null;
            const ssid = ap?.get_ssid();
            if (ssid)
                wifi = NM.utils_ssid_to_utf8(ssid.get_data());
        }
        const ip = c?.get_ip4_config()?.get_addresses()?.[0]?.get_address() ?? null;
        this._set({wifi: {state: wifi}, ip_address: {state: ip}});
    }
});
