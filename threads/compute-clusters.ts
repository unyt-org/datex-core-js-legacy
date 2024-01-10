import { Datex } from "../mod.ts";
import { Endpoint } from "../types/addressing.ts";
import { ESCAPE_SEQUENCES, Logger } from "../utils/logger.ts";

const logger = new Logger("ComputeCluster", true);

@sync("ComputeCluster")
export class ComputeCluster {

	private constructor(name: string) {	
		this.name = name;
		this.users.add(Datex.Runtime.endpoint);
	}

	/**
	 * The name of this cluster.
	 */
	@property readonly name: string;

	/**
	 * List of all endpoints that can request computations in this cluster.
	 */
	@property users = new Set<Endpoint>();

	/**
	 * List of all endpoints that can provide computations in this cluster.
	 */
	@property endpoints = new Map<Endpoint, number>();

	/**
	 * Join this cluster with the current endpoint.
	 * Cluster users now expect that they can request computations from this endpoint.
	 */
	@property private join() {
		const endpoint = datex.meta.sender;
		logger.success(`endpoint ${endpoint} joined cluster "${this.name}"`)
		this.endpoints.set(endpoint, 0);
	}

	static create(id: string, name = id) {
		const cluster = new ComputeCluster(name);
		Datex.Runtime.endpoint.setProperty(id, cluster);
		const identifier = `${Datex.Runtime.endpoint.main}.${id}`
		logger.success(`Created new cluster "${name}". Call #color(white)[ComputeCluster.join('${identifier}')] on external endpoints to add them to this cluster`)
		return cluster;
	}
	
	static async join(cluster: ComputeCluster|string) {
		if (typeof cluster === "string") {
			cluster = await datex(cluster);
			if (!(cluster instanceof ComputeCluster)) throw new Error(`"${cluster}" is not a ComputeCluster`)
		}

		const ptr = Datex.Pointer.getByValue(cluster);
		if (!ptr) throw new Error(`ComputeCluster "${cluster.name}" is not a bound to a pointer`)

		for (const user of cluster.users) {
			Datex.Runtime.addTrustedEndpoint(user, [
				"remote-js-execution"
			]);
		}

		await cluster.join();
		
		logger.success(`joined cluster "${cluster.name}"`)

		return cluster;
	}
}

