import { Datex } from "../mod.ts";
import { Endpoint } from "../types/addressing.ts";
import { Logger } from "../utils/logger.ts";

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
		// SECURITY: the caller identity is only trustworthy if the message was signed
		if (!datex.meta.signed) throw new Error("ComputeCluster.join() must be called with a signed message");
		const endpoint = datex.meta.caller;
		if (!endpoint) throw new Error("ComputeCluster.join(): unknown caller");
		logger.success(`endpoint ${endpoint} joined cluster "${this.name}"`)
		this.endpoints.set(endpoint, 0);
	}

	/**
	 * Create a new cluster with the given identifier.
	 * Per default, the current endpoint is the only authorized user of the cluster
	 * that can request computations from other endpoint that join this cluster.
	 * 
	 * @param id cluster identifier (no spaces, no special characters)
	 * @param name optional human-readable name of the cluster
	 * @returns the created cluster
	 */
	static create(id: string, name = id) {
		if (!id.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/)) throw new Error(`Invalid cluster identifier "${id}". Only letters, numbers and underscores are allowed.`)
		
		const cluster = new ComputeCluster(name);
		Datex.Runtime.endpoint.setProperty(id, cluster);
		const identifier = `${Datex.Runtime.endpoint.main}.${id}`
		logger.success(`Created new cluster "${name}". Call #color(white)[ComputeCluster.join('${identifier}')] on external endpoints to add them to this cluster`)
		return cluster;
	}
	
	/**
	 * Join an existing compute cluster.
	 * By joining a cluster, the current endpoint allows authorized
	 * users of the cluster to perform computations on this endpoint.
	 * @param cluster ComputeCluster or DATEX identifier of the cluster (e.g. "@myEndpoint.myComputCluster")
	 * @returns the joined cluster
	 */
	static async join(cluster: ComputeCluster|string) {
		if (typeof cluster === "string") {
			cluster = await datex(cluster);
			if (!(cluster instanceof ComputeCluster)) throw new Error(`"${cluster}" is not a ComputeCluster`)
		}
		else if (!(cluster instanceof ComputeCluster)) throw new Error(`cluster must be a ComputeCluster or a DATEX identifier (e.g. "@myEndpoint.myComputCluster")`)

		const ptr = Datex.Pointer.getByValue(cluster);
		if (!ptr) throw new Error(`ComputeCluster "${cluster.name}" is not a bound to a pointer`)

		// SECURITY: all cluster users are granted remote JS execution on this endpoint
		// (only the users at join time, later changes to cluster.users are not trusted)
		const users = [...cluster.users].filter(user => user instanceof Endpoint);
		logger.warn(`joining cluster "${cluster.name}" grants remote JS execution on this endpoint to: ${users.map(u=>u.toString()).join(", ")}`);
		for (const user of users) {
			Datex.Runtime.addTrustedEndpoint(user, [
				"remote-js-execution"
			]);
		}

		await cluster.join();
		logger.success(`joined cluster "${cluster.name}"`)
		return cluster;
	}
}

