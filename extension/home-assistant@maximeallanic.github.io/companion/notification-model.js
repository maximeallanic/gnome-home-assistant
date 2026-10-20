// Home Assistant notifications -> display model: pure conversion, no gi://. Displayed by notifications.js.
import {COMMAND_PREFIX} from './commands.js';

function text(v) {
    return typeof v === 'string' || typeof v === 'number' ? String(v) : '';
}

// defaultTitle: the title when HA sends none (translated by the caller; this module has no gettext).
export function toModel(message, title, data, defaultTitle = 'Home Assistant') {
    data = data && typeof data === 'object' ? data : {};
    message = text(message);
    if (!message || message.startsWith(COMMAND_PREFIX))
        return {type: 'ignore'};
    const tag = text(data.tag) || null;
    if (message === 'clear_notification')
        return tag ? {type: 'clear', tag} : {type: 'ignore'};
    const actions = (Array.isArray(data.actions) ? data.actions : [])
        .filter(a => a && text(a.action) && text(a.title))
        .map(a => ({action: text(a.action), title: text(a.title)}));
    const url = typeof data.url === 'string' && /^https?:\/\/[^\s/]+/i.test(data.url) ? data.url : null;
    return {
        type: 'show',
        title: text(title) || defaultTitle,
        body: message,
        actions,
        tag,
        url,
        urgent: data.importance === 'high',
    };
}
