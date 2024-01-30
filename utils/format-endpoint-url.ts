import { Endpoint, Institution, Person } from "../types/addressing.ts";

export function formatEndpointURL(endpoint:Endpoint) {
	const domainName = normalizeDomainName(endpoint.name);
	if (endpoint instanceof Institution) return `${domainName}.unyt.app`
	else if (endpoint instanceof Person) return `${domainName}.unyt.app` // TODO: unyt.me?
	else return `${domainName}.unyt.app`
}

function normalizeDomainName(name: string) {
	return name.replaceAll("_", "-");
}