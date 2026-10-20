// /proc and hwmon parsing, with the hwmon layouts of several kinds of machines.
import {eq, done} from './assert.js';
import {parseCpu, cpuPercent, memoryPercent, parseHwmon, round}
    from '../../extension/home-assistant@maximeallanic.github.io/sensors/parse.js';

const STAT1 = 'cpu  100 0 100 700 100 0 0 0 0 0\ncpu0 1 1 1 1 1 0 0 0 0 0\n';
const STAT2 = 'cpu  150 0 150 750 150 0 0 0 0 0\n';
eq(parseCpu(STAT1), {total: 1000, idle: 800}, 'parseCpu');
eq(cpuPercent(parseCpu(STAT1), parseCpu(STAT2)), 50, 'cpu 50 %');
eq(cpuPercent(parseCpu(STAT1), parseCpu(STAT1)), 0, 'cpu without change');
eq(parseCpu('cpu  10 0 10 70 10 0 0 0 5 5\n'), {total: 100, idle: 80}, 'guest already counted in user');
eq(parseCpu(''), null, 'unreadable stat');
eq(memoryPercent('MemTotal: 1000 kB\nMemFree: 100 kB\nMemAvailable: 637 kB\n'), 36, 'memory');
eq(memoryPercent('MemFree: 1 kB\n'), null, 'incomplete meminfo');

const chromebook = [{name: 'nvme', files: {temp1_input: '39850'}},
    {name: 'cros_ec', files: {fan1_input: '4062', temp1_input: '49850', temp1_label: 'DDR', temp2_input: '54850',
        temp2_label: 'SOC'}}];
eq(parseHwmon(chromebook), {temperature: 54.9, fan: 4062}, 'Chromebook (cros_ec)');
const intel = [{name: 'acpitz', files: {temp1_input: '27800'}},
    {name: 'coretemp', files: {temp1_input: '61000', temp1_label: 'Package id 0', temp2_input: '58000',
        temp2_label: 'Core 0'}},
    {name: 'thinkpad', files: {fan1_input: '2900'}}];
eq(parseHwmon(intel), {temperature: 61, fan: 2900}, 'Intel laptop (coretemp before acpitz)');
const amd = [{name: 'k10temp', files: {temp1_input: '45250', temp1_label: 'Tctl', temp3_input: '40000',
    temp3_label: 'Tccd1'}}];
eq(parseHwmon(amd), {temperature: 45.3, fan: null}, 'AMD desktop (k10temp Tctl)');
eq(parseHwmon([{name: 'cpu_thermal', files: {temp1_input: '52000'}}]), {temperature: 52, fan: null}, 'ARM board');
eq(parseHwmon([{name: 'acpitz', files: {temp1_input: '30000'}}]), {temperature: 30, fan: null}, 'ACPI zone only');
eq(parseHwmon([{name: 'nvme', files: {}}]), {temperature: null, fan: null}, 'nothing known');
eq(parseHwmon([{name: 'cros_ec\n', files: {temp2_label: 'SOC\n', temp2_input: '41000\n'}}]),
    {temperature: 41, fan: null}, 'line ends of sysfs files');
eq(round(356.849, 1), 356.8, 'round');
eq(round(36.5, 0), 37, 'round to integer');
done('parse');
