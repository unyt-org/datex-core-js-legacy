import { cache_path } from "../../runtime/cache_path.ts";
import { Endpoint } from "../../types/addressing.ts";
import { PermissionError } from "../../types/errors.ts";
import { Path } from "../../utils/path.ts";

@endpoint export class DatexInspectorRequest {

    static endpointHasAccess(endpoint: Endpoint) {
		// check if .datex-cache/inspector has file with endpoint name
		const path = new Path(cache_path).getChildRoute("inspectors").getChildRoute(endpoint.toString());
		if (path.fs_exists) {
			return true;
		}
		return false;
	}

    /**
     * requests the DATEX Inspector interface to be loaded
     * so that an endpoint can create a new inspector connection
     * This method can only be called by endpoints that are listed
     * in .datex-cache/inspectors
     */
    @property static async request() {
        if (!this.endpointHasAccess(datex.meta.caller.main)) {
            throw new PermissionError("Unauthorized");
        }
        await import("https://cdn.unyt.org/datex-inspector/inspector.ts")
        return true;
    }
}