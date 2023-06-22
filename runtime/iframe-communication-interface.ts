
export abstract class IframeCommunicationInterface<incomingMessages extends Record<string, [unknown, unknown]>, outgoingMessages extends Record<string, [unknown, unknown]>> {

	#iframe?: HTMLIFrameElement
	#origin?: URL|null;

	#other!: Window
	#connected = false;

	get origin() {
		return this.#origin
	}

	constructor(origin?: URL|string|null, private isHost = true) {
		this.#origin = origin ? new URL(origin) : null;

		this.initMessageListener();
		if (this.isHost) this.initIframeHost();
		else this.initIframeClient()
	}

	private initIframeHost() {
		if (!this.#origin) throw new Error("The origin must be defined when using IframeCommunicationInterface in host mode");
		this.#iframe = document.createElement("iframe");
		this.#iframe.src = this.#origin.toString();
		this.#iframe.sandbox.add('allow-scripts');
		this.#iframe.sandbox.add('allow-same-origin');
		document.head.append(this.#iframe);
		this.#other = this.#iframe.contentWindow!;
	}

	private initIframeClient() {
		this.#other = parent;
		this.#other.postMessage({type:'loaded'}, '*');
	}

	private initMessageListener() {
		globalThis.addEventListener('message', async (event) => {
			if (!this.#origin || event.origin == this.#origin.origin) {
				this.#origin = new URL(event.origin);
				if (event.data.type == "response") {
					const rid = event.data.rid;
					const error = event.data.error;
					if (rid != null && this.#responses.has(rid)) {
						this.#responses.get(rid)![error ? 1 : 0](event.data.data)
						this.#responses.delete(rid);
					}
				}
				else if (event.data.type == "loaded") {
					if (!this.#connected) {
						this.#other.postMessage({type:'loaded'}, '*');
						this.onConnected();
					}
					this.#connected = true;
				}
				else {
					const rid = event.data.rid;
					try {
						const res = await this.onMessage(event.data.type, event.data.data);
						if (rid != null) this.#other.postMessage({type:'response', data: res, rid}, '*');
					}
					catch (e: any) {
						if (rid != null) this.#other.postMessage({type:'response', error: true, data: e.toString(), rid}, '*');
					}
				}
			}
		}, false);
	}

	protected abstract onConnected(): void
	protected abstract onMessage<T extends keyof incomingMessages>(type: T, data: incomingMessages[T][0]): Promise<incomingMessages[T][1]>|incomingMessages[T][1]

	#rid = 0;
	#responses = new Map<number, [Function, Function]>()

	protected sendMessage<T extends keyof outgoingMessages>(type: T, data: outgoingMessages[T][0]): Promise<outgoingMessages[T][1]> {
		const rid = this.#rid++;
		this.#other!.postMessage({type, data, rid}, "*")

		return new Promise((resolve, reject) => {
			this.#responses.set(rid, [resolve, reject]);
		})
	}

}
