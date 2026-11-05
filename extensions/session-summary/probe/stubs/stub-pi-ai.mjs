export const __calls = [];
let responder = () => ({ stopReason: "stop", content: [{ type: "text", text: "generic summary line" }], usage: { input: 100, output: 10, cost: { input: 0.001, output: 0.0001, cacheRead: 0, cacheWrite: 0, total: 0.0011 } } });
export function complete(model, params, options) {
	__calls.push({ model, params, options });
	try {
		return Promise.resolve(responder(__calls.length, params));
	} catch (err) {
		return Promise.reject(err);
	}
}
export function __setResponder(fn) { responder = fn; }
export function __reset() { __calls.length = 0; responder = () => ({ stopReason: "stop", content: [{ type: "text", text: "generic summary line" }], usage: { input: 100, output: 10, cost: { input: 0.001, output: 0.0001, cacheRead: 0, cacheWrite: 0, total: 0.0011 } } }); }
