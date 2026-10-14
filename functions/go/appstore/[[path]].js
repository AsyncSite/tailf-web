// /go/appstore/{source}/: counts the tap, then opens the phone's store or the PC
// web alert door (lib/store-door.mjs). Unknown words fall through to static files.
export { onRequest } from '../../../lib/store-door.mjs';
