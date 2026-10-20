// State words in the session language, from Home Assistant's own translations.
import {eq, runAsync} from './assert.js';
import {fetchStateNames, languageCandidates, stateName}
    from '../../extension/home-assistant@maximeallanic.github.io/state-names.js';

eq(languageCandidates('fr-FR'), ['fr-FR', 'fr-Latn', 'fr'], 'region, script, language');
eq(languageCandidates('pt-BR'), ['pt-BR', 'pt-Latn', 'pt'], 'Home Assistant names Brazilian Portuguese by region');
eq(languageCandidates('zh-TW'), ['zh-TW', 'zh-Hant', 'zh'], 'traditional Chinese by script');
eq(languageCandidates('zh-CN'), ['zh-CN', 'zh-Hans', 'zh'], 'simplified Chinese by script');
eq(languageCandidates('sr-Latn-RS'), ['sr-RS', 'sr-Latn', 'sr'], 'Serbian in Latin script');
eq(languageCandidates('ar'), ['ar-Arab', 'ar'], 'no region');
eq(languageCandidates('not a tag'), ['en'], 'invalid tag');

const names = {
    'component.light.entity_component._.state.on': 'Allumé',
    'component.binary_sensor.entity_component._.state.off': 'Désactivé',
    'component.binary_sensor.entity_component.window.state.off': 'Fermée',
};
eq(stateName(names, 'light.office', {state: 'on', attributes: {}}), 'Allumé', 'domain default');
eq(stateName(names, 'binary_sensor.w', {state: 'off', attributes: {device_class: 'window'}}), 'Fermée',
    'device class first');
eq(stateName(names, 'binary_sensor.x', {state: 'off', attributes: {device_class: 'moisture'}}), 'Désactivé',
    'device class without translation falls back to the domain');
eq(stateName(names, 'sensor.text', {state: 'Partly sunny', attributes: {}}), null, 'free text is not translated');
eq(stateName(null, 'light.office', {state: 'on', attributes: {}}), null, 'no translations yet');

runAsync('tests/unit/test_state_names.js', async () => {
    const english = {'component.light.entity_component._.state.on': 'On'};
    const answers = {en: english, fr: names};  // any other language: HA answers in English
    const asked = [];
    const client = {
        call: msg => {
            asked.push(msg.language);
            eq([msg.category, msg.integration], ['entity_component', ['light']], 'request');
            return Promise.resolve({resources: answers[msg.language] ?? english});
        },
    };
    eq(await fetchStateNames(client, ['light'], 'fr-FR'), names, 'French found after fr-FR and fr-Latn');
    eq(asked, ['en', 'fr-FR', 'fr-Latn', 'fr'], 'candidates asked in order');
    eq(await fetchStateNames(client, ['light'], 'xx-YY'), english, 'unknown language: English');
    eq(await fetchStateNames(client, [], 'fr-FR'), {}, 'nothing tracked: nothing asked');
});
