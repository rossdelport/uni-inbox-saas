// Combined entrypoint: HTTP API + IMAP sync supervisor in one process.
// Used on Railway's single-service setup; SERVICE_ROLE env splits them apart
// again if the deployment ever moves to separate services.
import "./index.js";
import "./worker.js";
