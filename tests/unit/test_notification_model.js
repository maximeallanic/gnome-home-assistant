// Home Assistant notifications to the display model.
import {eq, done} from './assert.js';
import {toModel} from '../../extension/home-assistant@maximeallanic.github.io/companion/notification-model.js';

eq(toModel('Washing machine done', 'Home', {actions: [{action: 'OK', title: 'Seen'}], tag: 'wash'}),
    {type: 'show', title: 'Home', body: 'Washing machine done', actions: [{action: 'OK', title: 'Seen'}], tag: 'wash',
        url: null, urgent: false}, 'full example');
eq(toModel('hello', null, null),
    {type: 'show', title: 'Home Assistant', body: 'hello', actions: [], tag: null, url: null, urgent: false},
    'default title');
eq(toModel('洗濯が終わりました', 'إشعار', null).title, 'إشعار', 'any script kept as is');
eq(toModel('x', '', {}).title, 'Home Assistant', 'empty title');
eq(toModel('x', null, {url: 'https://ha.example/lovelace'}).url, 'https://ha.example/lovelace', 'https url');
eq(toModel('x', null, {url: '/lovelace/0'}).url, null, 'relative url');
eq(toModel('x', null, {url: 'javascript:alert(1)'}).url, null, 'non-http url');
eq(toModel('x', null, {actions: [{action: 'A'}, {title: 'B'}, {action: 'C', title: 'Ok'}, 'z']}).actions,
    [{action: 'C', title: 'Ok'}], 'incomplete actions ignored');
eq(toModel('x', null, {actions: 'not a list'}).actions, [], 'actions not a list');
eq(toModel('x', null, {importance: 'high'}).urgent, true, 'high importance');
eq(toModel('x', null, {importance: 'low'}).urgent, false, 'low importance');
eq(toModel('x', null, {tag: 42}).tag, '42', 'numeric tag');
eq(toModel('clear_notification', null, {tag: 'wash'}), {type: 'clear', tag: 'wash'}, 'clear');
eq(toModel('clear_notification', null, {}), {type: 'ignore'}, 'clear without tag');
eq(toModel('command_volume', null, {level: 3}), {type: 'ignore'}, 'command ignored');
eq(toModel('', null, null), {type: 'ignore'}, 'empty message');
eq(toModel(null, 'T', null), {type: 'ignore'}, 'no message');
done('notification-model');
