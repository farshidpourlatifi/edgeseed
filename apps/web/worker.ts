import handle from "hono-react-router-adapter/cloudflare-workers";
import * as build from "./build/server";
import app from "./server";
import { getLoadContext } from "./load-context";

export default handle(build, app, { getLoadContext });
