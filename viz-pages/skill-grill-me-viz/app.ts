// grill-me-viz poster: the exhibits and the beat-five machine. Each exhibit lives in its own module
// and builds its own DOM into the stage the page leaves for it. All data is invented.
import { initAck } from "./ack.js";
import { initCut } from "./cut.js";
import { initHandoff } from "./handoff.js";
import { initHow } from "./how.js";
import { initKeys } from "./keys.js";
import { initLadder } from "./ladder.js";
import { initOutage } from "./outage.js";
import { initPin } from "./pin.js";
import { initShot } from "./shot.js";
import { initSquint } from "./squint.js";

initAck();
initPin();
initOutage();
initHandoff();
initKeys();
initShot();
initLadder();
initCut();
initSquint();
initHow();
