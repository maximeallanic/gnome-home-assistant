// Pure parsing of /proc and hwmon: no gi:// here, testable with gjs -m.

export function round(v, decimals) {
    const f = 10 ** decimals;
    return Math.round(v * f) / f;
}

// Aggregated "cpu" line: user nice system idle iowait irq softirq steal [guest guest_nice].
// guest and guest_nice are already counted in user and nice: not added.
export function parseCpu(stat) {
    const line = /^cpu\s+(.+)$/m.exec(stat ?? '');
    if (!line)
        return null;
    const v = line[1].trim().split(/\s+/).map(Number).slice(0, 8);
    if (v.length < 5 || v.some(n => !Number.isFinite(n)))
        return null;
    return {total: v.reduce((a, b) => a + b, 0), idle: v[3] + v[4]};
}

export function cpuPercent(before, after) {
    const total = after.total - before.total;
    if (total <= 0)
        return 0;
    return Math.min(100, Math.max(0, Math.round(100 * (total - (after.idle - before.idle)) / total)));
}

export function memoryPercent(meminfo) {
    const field = name => Number(new RegExp(`^${name}:\\s+(\\d+)`, 'm').exec(meminfo ?? '')?.[1]);
    const total = field('MemTotal');
    const available = field('MemAvailable');
    if (!(total > 0) || !Number.isFinite(available))
        return null;
    return Math.round(100 * (1 - available / total));
}

// Where the processor temperature is, by hwmon driver name, most specific first: [driver, label or null (temp1)].
// cros_ec: Chromebooks; coretemp: Intel; k10temp/zenpower: AMD; cpu_thermal/soc_thermal: ARM boards; acpitz: ACPI zone.
const CPU_TEMPERATURE = [
    ['cros_ec', 'SOC'], ['coretemp', 'Package id 0'], ['k10temp', 'Tctl'], ['zenpower', 'Tctl'],
    ['cpu_thermal', null], ['soc_thermal', null], ['acpitz', null],
];

// dirs: [{name, files: {file name: content}}] read from /sys/class/hwmon (temp*_input, temp*_label, fan*_input).
// Temperature in °C (one decimal) of the first match of CPU_TEMPERATURE; fan speed (rpm) of the first fan input found
// (cros_ec first). null when the machine exposes neither.
export function parseHwmon(dirs) {
    const result = {temperature: null, fan: null};
    const byName = name => dirs.filter(d => d.name?.trim() === name);
    for (const [driver, label] of CPU_TEMPERATURE) {
        for (const dir of byName(driver)) {
            const f = dir.files;
            let input = label === null ? 'temp1_input' : null;
            for (const [file, value] of Object.entries(f)) {
                const m = /^temp(\d+)_label$/.exec(file);
                if (label !== null && m && value.trim() === label)
                    input = `temp${m[1]}_input`;
            }
            const raw = input ? f[input]?.trim() : '';
            const milli = Number(raw);
            if (raw && Number.isFinite(milli)) {
                result.temperature = round(milli / 1000, 1);
                break;
            }
        }
        if (result.temperature !== null)
            break;
    }
    const ordered = [...byName('cros_ec'), ...dirs.filter(d => d.name?.trim() !== 'cros_ec')];
    for (const dir of ordered) {
        const file = Object.keys(dir.files).filter(n => /^fan\d+_input$/.test(n)).sort()[0];
        const raw = file ? dir.files[file].trim() : '';
        const rpm = Number(raw);
        if (raw && Number.isFinite(rpm)) {
            result.fan = rpm;
            break;
        }
    }
    return result;
}
