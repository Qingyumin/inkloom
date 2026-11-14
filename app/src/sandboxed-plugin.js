export function sandboxedActivation(source) {
  return async api => {
    const token = crypto.randomUUID(); const nonce = crypto.randomUUID().replaceAll('-', '');
    const frame = document.createElement('iframe'); frame.hidden = true; frame.title = 'Inkloom isolated plugin'; frame.dataset.pluginSandbox = api.pluginId;
    frame.setAttribute('sandbox', 'allow-scripts'); frame.referrerPolicy = 'no-referrer';
    let complete; let rejectReady;
    let callbackSequence = 0; let disposed = false;
    const subscriptions = new Map(); const callbacks = new Map();
    const ready = new Promise((resolve, reject) => { complete = resolve; rejectReady = reject; });
    const timeout = setTimeout(() => rejectReady(new Error('Plugin activation timed out')), 5000);
    const invoke = (callbackId, args) => new Promise((resolve, reject) => {
      if (disposed) { reject(new Error('Plugin is disabled')); return; }
      const id = ++callbackSequence;
      const timer = setTimeout(() => { callbacks.delete(id); reject(new Error('Plugin callback timed out')); }, 5000);
      callbacks.set(id, { resolve, reject, timer });
      frame.contentWindow.postMessage({ token, type: 'callback', id, callbackId, args }, '*');
    });
    const receive = async event => {
      if (event.source !== frame.contentWindow || event.origin !== 'null' || event.data?.token !== token) return;
      const message = event.data;
      if (message.type === 'callback-result') {
        const callback = callbacks.get(message.id); if (!callback) return;
        callbacks.delete(message.id); clearTimeout(callback.timer);
        if (message.error) callback.reject(new Error(String(message.error))); else callback.resolve(message.result);
        return;
      }
      if (message.type === 'ready') { clearTimeout(timeout); complete(); return; }
      if (message.type === 'failed') { clearTimeout(timeout); const error = new Error(String(message.error).slice(0, 500)); rejectReady(error); if (!disposed) api.fail(error.message); return; }
      if (message.type === 'evidence') { frame.dataset.isolationEvidence = JSON.stringify(message.value); return; }
      if (message.type !== 'call' || !Number.isInteger(message.id) || !Array.isArray(message.args)) return;
      try {
        const methods = {
          query: api.queryAsync, read: api.read, write: api.write, request: api.request, execute: api.execute,
          registerView: api.registerView, updateView: api.updateView, showView: api.showView, open: api.open,
          registerSetting: api.registerSetting, getSetting: api.getSetting, setSetting: api.setSetting,
          subscribe: (name, callbackId) => {
            if (!Number.isInteger(callbackId) || callbackId < 1 || subscriptions.has(callbackId)) throw new Error('Invalid subscription');
            subscriptions.set(callbackId, api.on(name, detail => invoke(callbackId, [detail]))); return callbackId;
          },
          unsubscribe: id => { const release = subscriptions.get(id); if (release) { release(); subscriptions.delete(id); } return true; },
          registerCommand: (descriptor, callbackId) => {
            if (!Number.isInteger(callbackId) || callbackId < 1) throw new Error('Invalid command callback');
            return api.registerCommand({ ...descriptor, run: () => invoke(callbackId, []) });
          },
        };
        if (!Object.hasOwn(methods, message.method)) throw new Error('Unknown sandbox API');
        const result = await methods[message.method](...message.args);
        frame.contentWindow?.postMessage({ token, type: 'reply', id: message.id, result }, '*');
      } catch (error) { frame.contentWindow?.postMessage({ token, type: 'reply', id: message.id, error: error.message }, '*'); }
    };
    window.addEventListener('message', receive);
    api.own(() => {
      disposed = true; clearTimeout(timeout); window.removeEventListener('message', receive); frame.remove();
      for (const release of subscriptions.values()) release(); subscriptions.clear();
      for (const callback of callbacks.values()) { clearTimeout(callback.timer); callback.reject(new Error('Plugin disabled')); } callbacks.clear();
      rejectReady(new Error('Plugin disabled'));
    });
    const bootstrap = `
      const token = ${JSON.stringify(token)};
      const pending = new Map(); const handlers = new Map(); let sequence = 0; let handlerSequence = 0;
      addEventListener('message', async event => {
        if (event.source !== parent || event.data?.token !== token) return;
        if (event.data.type === 'callback') {
          try { const handler = handlers.get(event.data.callbackId); if (!handler) throw new Error('Callback unavailable'); const result = await handler(...event.data.args); parent.postMessage({token, type:'callback-result', id:event.data.id, result}, '*'); }
          catch (error) { parent.postMessage({token, type:'callback-result', id:event.data.id, error:error.message}, '*'); }
          return;
        }
        if (event.data.type !== 'reply') return;
        const request = pending.get(event.data.id); if (!request) return; pending.delete(event.data.id);
        clearTimeout(request.timer);
        if (event.data.error) request.reject(new Error(event.data.error)); else request.resolve(event.data.result);
      });
      const call = (method, args) => new Promise((resolve,reject) => { const id = ++sequence; const timer = setTimeout(() => { pending.delete(id); reject(new Error('Host request timed out')); }, 5000); pending.set(id, {resolve,reject,timer}); parent.postMessage({token,type:'call',id,method,args}, '*'); });
      const api = Object.fromEntries(['query','read','write','request','execute','registerView','updateView','showView','open','registerSetting','getSetting','setSetting'].map(method => [method, (...args) => call(method,args)]));
      api.on = async (event, handler) => { if (typeof handler !== 'function') throw new Error('Invalid event handler'); const id = ++handlerSequence; handlers.set(id,handler); try { await call('subscribe',[event,id]); } catch(error) { handlers.delete(id); throw error; } return async () => { handlers.delete(id); await call('unsubscribe',[id]); }; };
      api.registerCommand = async descriptor => { const {run, ...metadata} = descriptor; if (typeof run !== 'function') throw new Error('Invalid command handler'); const id = ++handlerSequence; handlers.set(id,run); try { return await call('registerCommand',[metadata,id]); } catch(error) { handlers.delete(id); throw error; } };
      const fail = message => parent.postMessage({token,type:'failed',error:message}, '*');
      addEventListener('error', event => fail(event.message)); addEventListener('unhandledrejection', event => fail(String(event.reason?.message || event.reason)));
      const evidence = value => parent.postMessage({ token, type: 'evidence', value }, '*');
      (async () => { ${source.replace(/<\/script/gi, '<\\/script')} })().then(() => parent.postMessage({token,type:'ready'}, '*'), error => parent.postMessage({token,type:'failed',error:error.message}, '*'));
    `;
    frame.srcdoc = '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'nonce-' + nonce + '\'; connect-src \'none\'; img-src \'none\'; frame-src \'none\'; form-action \'none\'; base-uri \'none\'"><script nonce="' + nonce + '">' + bootstrap + '</script>';
    document.body.append(frame);
    await ready;
  };
}