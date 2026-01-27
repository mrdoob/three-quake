/**
 * DemoPlayer - Quake demo file (.dem) playback
 *
 * Demo file format:
 * - First line: CD track number (ASCII, newline terminated)
 * - Then repeating blocks:
 *   - 4 bytes: message length (int32 LE)
 *   - 12 bytes: view angles (3 floats LE: pitch, yaw, roll)
 *   - N bytes: message data (server protocol messages)
 *
 * For this port, we focus on camera movement playback.
 * Full entity updates would require implementing the entire
 * server protocol (svc_* messages).
 */

// Server message types (from protocol.h)
const SVC = {
    BAD: 0,
    NOP: 1,
    DISCONNECT: 2,
    UPDATESTAT: 3,
    VERSION: 4,
    SETVIEW: 5,
    SOUND: 6,
    TIME: 7,
    PRINT: 8,
    STUFFTEXT: 9,
    SETANGLE: 10,
    SERVERINFO: 11,
    LIGHTSTYLE: 12,
    UPDATENAME: 13,
    UPDATEFRAGS: 14,
    CLIENTDATA: 15,
    STOPSOUND: 16,
    UPDATECOLORS: 17,
    PARTICLE: 18,
    DAMAGE: 19,
    SPAWNSTATIC: 20,
    SPAWNBINARY: 21,
    SPAWNBASELINE: 22,
    TEMP_ENTITY: 23,
    SETPAUSE: 24,
    SIGNONNUM: 25,
    CENTERPRINT: 26,
    KILLEDMONSTER: 27,
    FOUNDSECRET: 28,
    SPAWNSTATICSOUND: 29,
    INTERMISSION: 30,
    FINALE: 31,
    CDTRACK: 32,
    SELLSCREEN: 33,
    CUTSCENE: 34,
    // Fast update flags
    UPDATE_BASEFRAME: 0x80
};

// Entity effects flags (from server.h:169-177)
// These are set per-entity via protocol and stored in ent.effects
export const EF = {
    BRIGHTFIELD: 1,   // Glowing particles around entity (Quad Damage)
    MUZZLEFLASH: 2,   // Gun flash
    BRIGHTLIGHT: 4,   // 400 radius dynamic light
    DIMLIGHT: 8,      // 200 radius dynamic light
    DARKLIGHT: 16,    // Negative light
    DARKFIELD: 32,    // Dark particles
    LIGHT: 64,        // Light effect
    NODRAW: 128       // Don't render entity
};

// Model flags (from model.h:291-298)
// These are embedded in MDL file headers (model.flags field)
export const MF = {
    ROCKET: 1,        // Rocket trail + dynamic light
    GRENADE: 2,       // Grenade smoke trail
    GIB: 4,           // Blood trail
    ROTATE: 8,        // Rotate (bonus items)
    TRACER: 16,       // Green split trail (Scrag)
    ZOMGIB: 32,       // Small blood trail (zombie gib)
    TRACER2: 64,      // Orange split trail + rotate (Hellknight)
    TRACER3: 128      // Purple trail (Vore)
};

// Stats indices (from quakedef.h:120-134)
export const STAT = {
    HEALTH: 0,
    FRAGS: 1,
    WEAPON: 2,
    AMMO: 3,
    ARMOR: 4,
    WEAPONFRAME: 5,
    SHELLS: 6,
    NAILS: 7,
    ROCKETS: 8,
    CELLS: 9,
    ACTIVEWEAPON: 10,
    TOTALSECRETS: 11,
    TOTALMONSTERS: 12,
    SECRETS: 13,
    MONSTERS: 14
};

export class DemoPlayer {
    constructor(game) {
        this.game = game;

        // Demo state
        this.data = null;
        this.offset = 0;
        this.playing = false;
        this.paused = false;

        // Timing - Quake style with mtime dual buffer
        // mtime is updated by svc_time messages in the protocol, not fixed intervals
        this.time = 0;
        this.oldtime = 0;
        this.mtime = [0, 0];  // mtime[0] = current message time, mtime[1] = previous

        // View state from demo - dual buffer for interpolation (like original Quake)
        // mviewangles[0] = newest from message, mviewangles[1] = previous
        this.mviewangles = [
            { pitch: 0, yaw: 0, roll: 0 },
            { pitch: 0, yaw: 0, roll: 0 }
        ];
        this.viewAngles = { pitch: 0, yaw: 0, roll: 0 };  // Interpolated result
        this.viewOrigin = { x: 0, y: 0, z: 0 };
        this.viewHeight = 22;  // Eye height
        this.viewEntity = 1;   // Usually player is entity 1

        // Velocity dual-buffer for interpolation (like original cl.mvelocity[0]/[1])
        this.mvelocity = [
            { x: 0, y: 0, z: 0 },
            { x: 0, y: 0, z: 0 }
        ];
        this.velocity = { x: 0, y: 0, z: 0 };  // Interpolated velocity (for view bob)
        this.onGround = true;  // Whether player is on ground

        // Punch angle from weapon fire/damage (from cl.punchangle in client.h)
        this.punchangle = { pitch: 0, yaw: 0, roll: 0 };

        // Entity state - dual buffer for interpolation (like original Quake cl_entities)
        // Each entity has msg_origins[0], msg_origins[1] and msg_angles[0], msg_angles[1]
        this.entities = new Map();  // Map of entityNum -> entity state
        this.staticEntities = [];   // Array of static entities (torches, decorations)
        this.stats = new Array(32).fill(0);  // Player stats (health, armor, ammo, etc.)

        // Demo info
        this.cdTrack = -1;
        this.mapName = null;

        // Precache lists (model index -> model path, sound index -> sound path)
        this.modelPrecache = [];
        this.soundPrecache = [];

        // Signon state (connection handshake)
        this.signon = 0;

        // Track if serverinfo has been parsed (to avoid re-triggering map loads)
        this.serverInfoParsed = false;

        // Message buffer for parsing
        this.msgData = null;
        this.msgOffset = 0;
        this.msgSize = 0;

        // Callbacks
        this.onFinished = null;
        this.onMapChange = null;

        // Error tracking (to reduce spam)
        this.parseErrors = 0;
        this.maxParseErrors = 5;
    }

    /**
     * Load a demo file from PAK
     */
    async load(pak, demoName) {
        // Try with and without .dem extension
        let path = demoName;
        if (!path.endsWith('.dem')) {
            path = demoName + '.dem';
        }

        const data = pak.get(path);
        if (!data) {
            console.error(`Demo not found: ${path}`);
            return false;
        }

        this.data = new Uint8Array(data);
        this.offset = 0;

        // Read CD track (first line, ASCII)
        this.cdTrack = this.readCDTrack();
        console.log(`Demo loaded: ${path}, CD track: ${this.cdTrack}`);

        this.playing = false;
        this.paused = false;
        this.time = 0;
        this.signon = 0;

        return true;
    }

    /**
     * Read CD track number from start of demo
     */
    readCDTrack() {
        let neg = false;
        let track = 0;

        while (this.offset < this.data.length) {
            const c = this.data[this.offset++];
            if (c === 0x0A) {  // newline
                break;
            } else if (c === 0x2D) {  // '-'
                neg = true;
            } else if (c >= 0x30 && c <= 0x39) {  // '0'-'9'
                track = track * 10 + (c - 0x30);
            }
        }

        return neg ? -track : track;
    }

    /**
     * Parse demo to find the map name (before starting playback)
     * Returns the map name or null if not found
     */
    findMapName() {
        if (!this.data) return null;

        // Save current state
        const savedOffset = this.offset;
        const savedMapName = this.mapName;
        const savedOnMapChange = this.onMapChange;

        // Disable callbacks during preview
        this.onMapChange = null;
        this.mapName = null;

        // Read messages until we find serverinfo with map name
        let attempts = 0;
        while (attempts < 100 && !this.mapName) {
            if (!this.readMessage()) {
                break;  // End of demo
            }
            attempts++;
        }

        const foundMap = this.mapName;

        // Restore state completely
        this.offset = savedOffset;
        this.mapName = savedMapName;
        this.onMapChange = savedOnMapChange;

        // Reset all parsing state that was modified during preview
        this.mtime[0] = 0;
        this.mtime[1] = 0;
        this.signon = 0;
        this.mviewangles[0] = { pitch: 0, yaw: 0, roll: 0 };
        this.mviewangles[1] = { pitch: 0, yaw: 0, roll: 0 };
        this.mvelocity[0] = { x: 0, y: 0, z: 0 };
        this.mvelocity[1] = { x: 0, y: 0, z: 0 };
        this.punchangle = { pitch: 0, yaw: 0, roll: 0 };
        this.entities.clear();
        this.serverInfoParsed = false;

        return foundMap;
    }

    /**
     * Reset to beginning of demo (after CD track header)
     */
    reset() {
        // Re-read from start to find CD track position
        this.offset = 0;
        this.cdTrack = this.readCDTrack();

        this.time = 0;
        this.oldtime = 0;
        this.mtime[0] = 0;
        this.mtime[1] = 0;
        this.signon = 0;

        // Reset interpolation buffers
        this.mviewangles[0] = { pitch: 0, yaw: 0, roll: 0 };
        this.mviewangles[1] = { pitch: 0, yaw: 0, roll: 0 };
        this.viewAngles = { pitch: 0, yaw: 0, roll: 0 };
        this.viewOrigin = { x: 0, y: 0, z: 0 };
        this.viewHeight = 22;
        this.viewEntity = 1;
        this.mvelocity[0] = { x: 0, y: 0, z: 0 };
        this.mvelocity[1] = { x: 0, y: 0, z: 0 };
        this.velocity = { x: 0, y: 0, z: 0 };
        this.onGround = true;
        this.punchangle = { pitch: 0, yaw: 0, roll: 0 };
        this.entities.clear();
        this.staticEntities = [];
        this.parseErrors = 0;
        this.serverInfoParsed = false;
    }

    /**
     * Start demo playback
     */
    play() {
        if (!this.data) {
            console.error('No demo loaded');
            return;
        }

        // Reset to beginning
        this.reset();

        this.playing = true;
        this.paused = false;
        console.log('Demo playback started');
    }

    /**
     * Stop demo playback
     */
    stop() {
        this.playing = false;
        this.paused = false;
        console.log('Demo playback stopped');
    }

    /**
     * Pause/unpause demo
     */
    togglePause() {
        this.paused = !this.paused;
    }

    /**
     * Update demo playback - Quake style with interpolation
     * Based on CL_ReadFromServer in cl_main.c
     */
    update(deltaTime) {
        if (!this.playing || this.paused || !this.data) {
            return;
        }

        // Update time like original Quake: cl.oldtime = cl.time; cl.time += host_frametime;
        this.oldtime = this.time;
        this.time += deltaTime;

        // Read messages in a loop until we don't need more (like original Quake)
        // Original: do { ret = CL_GetMessage(); ... } while (ret && cls.state == ca_connected);
        // Limit messages per frame to prevent infinite loops during signon
        let ret;
        let messagesRead = 0;
        const maxMessagesPerFrame = 1000;  // Safety limit

        do {
            ret = this.getMessage();
            if (ret === -1) {
                // Demo finished
                this.stop();
                if (this.onFinished) {
                    this.onFinished();
                }
                return;
            }
            messagesRead++;
            if (messagesRead >= maxMessagesPerFrame) {
                console.warn('Demo: too many messages in one frame, breaking');
                break;
            }
        } while (ret === 1);

        // Calculate interpolation fraction (like CL_LerpPoint in original Quake)
        const frac = this.calcLerpFrac();

        // Interpolate view angles with 360-degree wraparound (like original Quake CL_RelinkEntities)
        this.viewAngles.pitch = this.lerpAngle(this.mviewangles[1].pitch, this.mviewangles[0].pitch, frac);
        this.viewAngles.yaw = this.lerpAngle(this.mviewangles[1].yaw, this.mviewangles[0].yaw, frac);
        this.viewAngles.roll = this.lerpAngle(this.mviewangles[1].roll, this.mviewangles[0].roll, frac);

        // Interpolate velocity (like original CL_RelinkEntities)
        // Original: cl.velocity[i] = cl.mvelocity[1][i] + frac * (cl.mvelocity[0][i] - cl.mvelocity[1][i])
        this.velocity.x = this.mvelocity[1].x + frac * (this.mvelocity[0].x - this.mvelocity[1].x);
        this.velocity.y = this.mvelocity[1].y + frac * (this.mvelocity[0].y - this.mvelocity[1].y);
        this.velocity.z = this.mvelocity[1].z + frac * (this.mvelocity[0].z - this.mvelocity[1].z);

        // Interpolate entities and apply effects (like CL_RelinkEntities in original Quake)
        // V_CalcRefdef uses: VectorCopy(ent->origin, r_refdef.vieworg); vieworg[2] += cl.viewheight
        this.relinkEntities(frac, deltaTime);
    }

    /**
     * Interpolate entity positions and apply effects (like CL_RelinkEntities in cl_main.c)
     * The view origin comes from the interpolated position of the view entity
     *
     * This processes:
     * - Entity position/angle interpolation
     * - Entity effects (EF_BRIGHTFIELD, EF_MUZZLEFLASH, EF_BRIGHTLIGHT, EF_DIMLIGHT)
     * - Model flags trails (EF_ROCKET, EF_GRENADE, EF_GIB, etc.)
     * - Rotating bonus items (EF_ROTATE)
     */
    relinkEntities(frac, deltaTime) {
        const effects = this.game.renderer?.effects;
        const renderer = this.game.renderer;

        // Rotating object angle (original: bobjrotate = anglemod(100*cl.time))
        const bobjrotate = (100 * this.time) % 360;

        // Process all entities
        for (const [entityNum, ent] of this.entities) {
            // Skip entities without model index (empty slot)
            if (!ent.modelIndex) {
                if (ent.forcelink) {
                    // Entity just became empty, clear forcelink
                    ent.forcelink = false;
                }
                continue;
            }

            // Skip entities not updated in the last message
            // Original: if (ent->msgtime != cl.mtime[0]) { ent->model = NULL; continue; }
            if (ent.msgtime !== this.mtime[0]) {
                continue;
            }

            // Store old origin for trail effects
            const oldorg = ent.origin ? { ...ent.origin } : { ...ent.msg_origins[0] };

            // Check if entity needs to be force-linked (no previous frame)
            if (ent.forcelink) {
                // Move to final spot without interpolation
                ent.origin = { ...ent.msg_origins[0] };
                ent.angles = { ...ent.msg_angles[0] };
            } else {
                // Calculate delta for teleport detection
                const delta = {
                    x: ent.msg_origins[0].x - ent.msg_origins[1].x,
                    y: ent.msg_origins[0].y - ent.msg_origins[1].y,
                    z: ent.msg_origins[0].z - ent.msg_origins[1].z
                };

                // If delta is large, assume teleport and don't lerp
                let f = frac;
                if (Math.abs(delta.x) > 100 || Math.abs(delta.y) > 100 || Math.abs(delta.z) > 100) {
                    f = 1;  // Teleportation, snap to final position
                }

                // Interpolate origin
                ent.origin = {
                    x: ent.msg_origins[1].x + f * delta.x,
                    y: ent.msg_origins[1].y + f * delta.y,
                    z: ent.msg_origins[1].z + f * delta.z
                };

                // Interpolate angles with wraparound
                ent.angles = {
                    pitch: this.lerpAngle(ent.msg_angles[1].pitch, ent.msg_angles[0].pitch, f),
                    yaw: this.lerpAngle(ent.msg_angles[1].yaw, ent.msg_angles[0].yaw, f),
                    roll: this.lerpAngle(ent.msg_angles[1].roll, ent.msg_angles[0].roll, f)
                };
            }

            // Get model flags from precache (if model is loaded)
            const modelPath = this.modelPrecache[ent.modelIndex];
            const modelFlags = renderer?.aliasRenderer?.getModelFlags(modelPath) || 0;

            // Rotate bonus items (MF.ROTATE in model flags)
            // Original: if (ent->model->flags & EF_ROTATE) ent->angles[1] = bobjrotate;
            if (modelFlags & MF.ROTATE) {
                ent.angles.yaw = bobjrotate;
            }

            // === Entity Effects (from ent.effects field sent via protocol) ===

            // EF_BRIGHTFIELD - Quad Damage particles (R_EntityParticles)
            if (ent.effects & EF.BRIGHTFIELD) {
                if (effects) {
                    effects.entityParticles(ent, this.time);
                }
            }

            // EF_MUZZLEFLASH - Gun flash dynamic light
            if (ent.effects & EF.MUZZLEFLASH) {
                if (renderer) {
                    // Original: dl->origin = ent->origin + 16 on Z + 18 forward
                    const yaw = ent.angles.yaw * Math.PI / 180;
                    renderer.addDynamicLight({
                        key: entityNum,  // Reuse light for same entity
                        position: {
                            x: ent.origin.x + Math.cos(yaw) * 18,
                            y: ent.origin.y + Math.sin(yaw) * 18,
                            z: ent.origin.z + 16
                        },
                        radius: 200 + (Math.random() * 32),
                        die: 0.1  // Duration in seconds
                    });
                }
            }

            // EF_BRIGHTLIGHT - 400 radius dynamic light
            if (ent.effects & EF.BRIGHTLIGHT) {
                if (renderer) {
                    renderer.addDynamicLight({
                        key: entityNum,
                        position: { x: ent.origin.x, y: ent.origin.y, z: ent.origin.z + 16 },
                        radius: 400 + (Math.random() * 32),
                        die: 0.001  // Very short, resets each frame
                    });
                }
            }

            // EF_DIMLIGHT - 200 radius dynamic light
            if (ent.effects & EF.DIMLIGHT) {
                if (renderer) {
                    renderer.addDynamicLight({
                        key: entityNum,
                        position: { ...ent.origin },
                        radius: 200 + (Math.random() * 32),
                        die: 0.001  // Very short, resets each frame
                    });
                }
            }

            // === Model Flags Trails (from model->flags embedded in MDL file) ===

            // Only apply trails if entity actually moved (not on forcelink/teleport)
            if (!ent.forcelink && effects) {
                // MF.GIB - Blood trail (type 2)
                if (modelFlags & MF.GIB) {
                    effects.rocketTrail(oldorg, ent.origin, 2);
                }
                // MF.ZOMGIB - Small blood trail (type 4)
                else if (modelFlags & MF.ZOMGIB) {
                    effects.rocketTrail(oldorg, ent.origin, 4);
                }
                // MF.TRACER - Green split trail (Scrag, type 3)
                else if (modelFlags & MF.TRACER) {
                    effects.rocketTrail(oldorg, ent.origin, 3);
                }
                // MF.TRACER2 - Orange split trail (Hellknight, type 5)
                else if (modelFlags & MF.TRACER2) {
                    effects.rocketTrail(oldorg, ent.origin, 5);
                }
                // MF.ROCKET - Rocket trail + dynamic light (type 0)
                else if (modelFlags & MF.ROCKET) {
                    effects.rocketTrail(oldorg, ent.origin, 0);
                    if (renderer) {
                        renderer.addDynamicLight({
                            key: entityNum,
                            position: { ...ent.origin },
                            radius: 200,
                            die: 0.01  // Very short, resets each frame
                        });
                    }
                }
                // MF.GRENADE - Grenade smoke trail (type 1)
                else if (modelFlags & MF.GRENADE) {
                    effects.rocketTrail(oldorg, ent.origin, 1);
                }
                // MF.TRACER3 - Purple trail (Vore, type 6)
                else if (modelFlags & MF.TRACER3) {
                    effects.rocketTrail(oldorg, ent.origin, 6);
                }
            }

            // Clear forcelink after processing
            ent.forcelink = false;

            // Update view origin from view entity
            if (entityNum === this.viewEntity) {
                // Don't add eye height here - Renderer.updateCamera handles that
                this.viewOrigin.x = ent.origin.x;
                this.viewOrigin.y = ent.origin.y;
                this.viewOrigin.z = ent.origin.z;
            }
        }
    }

    /**
     * Get next message if needed (like CL_GetMessage in cl_demo.c)
     * Returns: 1 = got message, 0 = don't need one yet, -1 = end of demo
     */
    getMessage() {
        // Original Quake: if (cls.signon == SIGNONS) check timing
        // SIGNONS = 4 for live servers, but demos only go to signon 3
        // After signon 3, we're ready to start timing-based playback
        // Only apply timing if we have valid mtime (not 0 from init)
        if (this.signon >= 3 && this.mtime[0] > 0) {
            // Don't need another message if time hasn't passed last message time
            // Original: if (cl.time <= cl.mtime[0]) return 0;
            if (this.time <= this.mtime[0]) {
                return 0;  // Don't need another message yet
            }
        }

        // Read the next message
        if (!this.readMessage()) {
            return -1;  // End of demo
        }

        return 1;  // Got a message
    }

    /**
     * Calculate interpolation fraction between message frames
     * Based on CL_LerpPoint in cl_main.c
     */
    calcLerpFrac() {
        let f = this.mtime[0] - this.mtime[1];

        // No interpolation if no time difference
        // Original also checks cl_nolerp, timedemo, and sv.active
        if (f <= 0) {
            this.time = this.mtime[0];
            return 1;
        }

        // Dropped packet or start of demo - clamp to 0.1 seconds
        // Original: if (f > 0.1) { cl.mtime[1] = cl.mtime[0] - 0.1; f = 0.1; }
        if (f > 0.1) {
            this.mtime[1] = this.mtime[0] - 0.1;
            f = 0.1;
        }

        let frac = (this.time - this.mtime[1]) / f;

        // Clamp frac and adjust time if needed (like original)
        if (frac < 0) {
            if (frac < -0.01) {
                this.time = this.mtime[1];
            }
            frac = 0;
        } else if (frac > 1) {
            if (frac > 1.01) {
                this.time = this.mtime[0];
            }
            frac = 1;
        }

        return frac;
    }

    /**
     * Interpolate angle with 360-degree wraparound (like original Quake)
     */
    lerpAngle(from, to, frac) {
        let d = to - from;

        // Handle 360-degree wraparound
        if (d > 180) {
            d -= 360;
        } else if (d < -180) {
            d += 360;
        }

        return from + frac * d;
    }

    /**
     * Read next demo message block
     * Based on the reading portion of CL_GetMessage in cl_demo.c
     */
    readMessage() {
        if (this.offset + 4 > this.data.length) {
            return false;  // End of demo
        }

        // Read message length
        const len = this.readInt32();

        // Sanity check message length
        if (len < 0 || len > 65536) {
            console.warn(`Demo: invalid message length ${len}, ending playback`);
            return false;
        }

        if (this.offset + 12 + len > this.data.length) {
            return false;  // End of demo
        }

        // Shift view angles buffer before reading new values (like original Quake)
        // Original: VectorCopy(cl.mviewangles[0], cl.mviewangles[1]);
        this.mviewangles[1].pitch = this.mviewangles[0].pitch;
        this.mviewangles[1].yaw = this.mviewangles[0].yaw;
        this.mviewangles[1].roll = this.mviewangles[0].roll;

        // Read view angles (3 floats) into mviewangles[0]
        // Original: cl.mviewangles[0][i] = LittleFloat(f);
        const pitch = this.readFloat();
        const yaw = this.readFloat();
        const roll = this.readFloat();

        // Sanity check angles (should be reasonable values)
        if (isFinite(pitch) && isFinite(yaw) && isFinite(roll)) {
            this.mviewangles[0].pitch = pitch;
            this.mviewangles[0].yaw = yaw;
            this.mviewangles[0].roll = roll;
        }

        // Read message data
        // Note: mtime is updated by svc_time messages within parseMessage()
        if (len > 0) {
            this.msgData = this.data.slice(this.offset, this.offset + len);
            this.msgOffset = 0;
            this.msgSize = len;
            this.offset += len;

            // Parse the message (errors are non-fatal)
            try {
                this.parseMessage();
            } catch (e) {
                if (this.parseErrors < this.maxParseErrors) {
                    console.warn('Demo: error parsing message:', e.message);
                    this.parseErrors++;
                }
            }
        }

        return true;
    }

    /**
     * Parse server message data
     */
    parseMessage() {
        while (this.msgOffset < this.msgSize) {
            const cmd = this.readMsgByte();

            // Check for fast update (entity update with flags in high bits)
            if (cmd & 0x80) {
                try {
                    this.parseFastUpdate(cmd);
                } catch (e) {
                    // Fast update parsing failed, skip rest of message
                    return;
                }
                continue;
            }

            switch (cmd) {
                case SVC.BAD:
                    // SVC_BAD usually means we're out of sync, skip rest of message
                    return;

                case SVC.NOP:
                    break;

                case SVC.DISCONNECT:
                    return;

                case SVC.TIME:
                    // Original Quake (cl_parse.c):
                    // cl.mtime[1] = cl.mtime[0];
                    // cl.mtime[0] = MSG_ReadFloat();
                    this.mtime[1] = this.mtime[0];
                    this.mtime[0] = this.readMsgFloat();

                    // Sync playback time with demo time on first valid TIME after signon
                    // This ensures our time is in the same range as the demo's server time
                    // Check if time is much smaller than mtime (not yet synced)
                    if (this.signon >= 3 && this.mtime[1] > 0 && this.time < this.mtime[1] - 1) {
                        this.time = this.mtime[1];
                        this.oldtime = this.mtime[1];
                    }
                    break;

                case SVC.PRINT:
                    this.readMsgString();  // Print text (don't log)
                    break;

                case SVC.STUFFTEXT:
                    this.readMsgString();  // Stuff text command (ignore)
                    break;

                case SVC.SETANGLE:
                    this.viewAngles.pitch = this.readMsgAngle();
                    this.viewAngles.yaw = this.readMsgAngle();
                    this.viewAngles.roll = this.readMsgAngle();
                    break;

                case SVC.SERVERINFO:
                    this.parseServerInfo();
                    break;

                case SVC.LIGHTSTYLE:
                    const styleIndex = this.readMsgByte();
                    const stylePattern = this.readMsgString();
                    if (this.game.renderer && this.game.renderer.lightStyles) {
                        this.game.renderer.lightStyles.setStyle(styleIndex, stylePattern);
                    }
                    break;

                case SVC.SOUND:
                    this.parseSound();
                    break;

                case SVC.STOPSOUND:
                    this.readMsgShort();  // entity + channel
                    break;

                case SVC.UPDATESTAT: {
                    const statIndex = this.readMsgByte();
                    const statValue = this.readMsgLong();
                    if (statIndex >= 0 && statIndex < this.stats.length) {
                        this.stats[statIndex] = statValue;
                    }
                    break;
                }

                case SVC.UPDATENAME:
                case SVC.UPDATEFRAGS:
                case SVC.UPDATECOLORS:
                    this.readMsgByte();   // player number
                    if (cmd === SVC.UPDATENAME) {
                        this.readMsgString();
                    } else if (cmd === SVC.UPDATEFRAGS) {
                        this.readMsgShort();
                    } else {
                        this.readMsgByte();
                    }
                    break;

                case SVC.CLIENTDATA:
                    this.parseClientData();
                    break;

                case SVC.PARTICLE:
                    this.parseParticle();
                    break;

                case SVC.DAMAGE:
                    this.readMsgByte();   // armor
                    this.readMsgByte();   // blood
                    this.readMsgCoord(); this.readMsgCoord(); this.readMsgCoord();
                    break;

                case SVC.SPAWNSTATIC:
                    this.parseSpawnStatic();
                    break;

                case SVC.SPAWNBASELINE:
                    this.parseSpawnBaseline();
                    break;

                case SVC.TEMP_ENTITY:
                    this.parseTempEntity();
                    break;

                case SVC.SETPAUSE:
                    this.paused = this.readMsgByte() !== 0;
                    break;

                case SVC.SIGNONNUM:
                    this.signon = this.readMsgByte();
                    break;

                case SVC.CENTERPRINT:
                    this.readMsgString();  // Center screen text
                    break;

                case SVC.KILLEDMONSTER:
                    // Increment kill counter (cl_parse.c:910)
                    this.stats[STAT.MONSTERS]++;
                    break;

                case SVC.FOUNDSECRET:
                    // Increment secret counter (cl_parse.c:914)
                    this.stats[STAT.SECRETS]++;
                    break;

                case SVC.SPAWNSTATICSOUND:
                    this.readMsgCoord(); this.readMsgCoord(); this.readMsgCoord();
                    this.readMsgByte();   // sound index
                    this.readMsgByte();   // volume
                    this.readMsgByte();   // attenuation
                    break;

                case SVC.INTERMISSION:
                case SVC.FINALE:
                case SVC.CUTSCENE:
                    if (cmd === SVC.FINALE || cmd === SVC.CUTSCENE) {
                        this.readMsgString();
                    }
                    break;

                case SVC.CDTRACK:
                    this.readMsgByte();   // track
                    this.readMsgByte();   // loop track
                    break;

                case SVC.SELLSCREEN:
                    break;

                case SVC.SETVIEW:
                    this.viewEntity = this.readMsgShort();
                    break;

                case SVC.VERSION:
                    this.readMsgLong();
                    break;

                default:
                    // Unknown command - skip rest of this message to avoid corruption
                    if (this.parseErrors < this.maxParseErrors) {
                        console.warn(`Demo: unknown cmd ${cmd}, skipping message`);
                        this.parseErrors++;
                    }
                    return;
            }
        }
    }

    /**
     * Parse serverinfo message (contains map name, etc.)
     */
    parseServerInfo() {
        const protocol = this.readMsgLong();
        const maxClients = this.readMsgByte();
        const gameType = this.readMsgByte();
        const message = this.readMsgString();

        // Read model precache list (must always read to keep parsing in sync)
        // Index 0 is empty, index 1 is the map, indices 2+ are entity models
        const models = [''];  // Index 0 is unused
        while (true) {
            const model = this.readMsgString();
            if (!model) break;
            models.push(model);
        }

        // Read sound precache list (must always read to keep parsing in sync)
        // Index 0 is empty, indices 1+ are sounds
        const sounds = [''];  // Index 0 is unused
        while (true) {
            const sound = this.readMsgString();
            if (!sound) break;
            sounds.push(sound);
        }

        // Only process serverinfo once per playback to avoid re-triggering map loads
        if (this.serverInfoParsed) {
            return;
        }
        this.serverInfoParsed = true;

        // Store precache lists for entity rendering
        this.modelPrecache = models;
        this.soundPrecache = sounds;

        // Preload demo sounds asynchronously
        this.preloadDemoSounds();

        console.log(`Demo serverinfo: protocol=${protocol}, maxClients=${maxClients}, gameType=${gameType}`);
        console.log(`Demo: ${models.length - 1} models, ${sounds.length - 1} sounds precached`);

        // First model (index 1) is the map
        if (models.length > 1) {
            // Extract map name from path like "maps/e1m1.bsp"
            const mapPath = models[1];
            const match = mapPath.match(/maps\/(.+)\.bsp/i);
            if (match) {
                this.mapName = match[1];
                console.log(`Demo: map is ${this.mapName}`);
                if (this.onMapChange) {
                    this.onMapChange(this.mapName);
                }
            }
        }
    }

    /**
     * Preload all sounds from the precache list
     * Called after parseServerInfo populates soundPrecache
     */
    async preloadDemoSounds() {
        if (!this.game.audio || !this.game.pak) return;

        for (const soundPath of this.soundPrecache) {
            if (soundPath) {
                await this.game.audio.loadSoundFromPAK(this.game.pak, 'sound/' + soundPath);
            }
        }
    }

    /**
     * Parse sound message
     * Based on CL_ParseStartSoundPacket in cl_parse.c
     */
    /**
     * Parse sound message (svc_sound)
     * Flags from protocol.h:
     *   SND_VOLUME (1<<0) - volume byte follows
     *   SND_ATTENUATION (1<<1) - attenuation byte follows
     *   SND_LOOPING (1<<2) - looping sound
     */
    parseSound() {
        const flags = this.readMsgByte();

        let volume = 255;
        let attenuation = 1.0;
        let looping = false;

        if (flags & 1) volume = this.readMsgByte();      // SND_VOLUME
        if (flags & 2) attenuation = this.readMsgByte() / 64.0;  // SND_ATTENUATION
        if (flags & 4) looping = true;  // SND_LOOPING

        // Decode entity and channel from combined short
        // Original: entity = channel >> 3, channel &= 7
        const entityChannel = this.readMsgShort();
        const entity = entityChannel >> 3;   // Top 13 bits are entity number
        const channel = entityChannel & 7;   // Bottom 3 bits are channel (0-7)

        const soundIndex = this.readMsgByte();
        const x = this.readMsgCoord();
        const y = this.readMsgCoord();
        const z = this.readMsgCoord();

        // Get entity position if it's the view entity (player)
        // This ensures sounds attached to the player follow the camera
        let position = { x, y, z };
        if (entity === this.viewEntity) {
            // Use player position for sounds originating from the player
            position = null; // null = 2D sound (no spatialization for self)
        }

        // Play the sound
        const soundPath = this.soundPrecache[soundIndex];
        if (soundPath && this.game.audio) {
            if (position) {
                this.game.audio.playPositioned(
                    'sound/' + soundPath,
                    position,
                    volume / 255,
                    attenuation,
                    looping
                );
            } else {
                // 2D sound for player's own sounds
                this.game.audio.playLocal('sound/' + soundPath, volume / 255);
            }
        }
    }

    /**
     * Parse clientdata (player state)
     * SU_ flags from protocol.h
     */
    /**
     * Parse client data (player state)
     * Based on CL_ParseClientdata in cl_parse.c
     */
    parseClientData() {
        const bits = this.readMsgShort();

        // SU_VIEWHEIGHT (1<<0) - if not set, use default
        if (bits & 0x0001) {
            this.viewHeight = this.readMsgChar();
        } else {
            this.viewHeight = 22;  // DEFAULT_VIEWHEIGHT
        }

        // SU_IDEALPITCH (1<<1)
        if (bits & 0x0002) this.readMsgChar();

        // Shift velocity buffer for interpolation (like original VectorCopy(cl.mvelocity[0], cl.mvelocity[1]))
        this.mvelocity[1].x = this.mvelocity[0].x;
        this.mvelocity[1].y = this.mvelocity[0].y;
        this.mvelocity[1].z = this.mvelocity[0].z;

        // Punch angles and velocity are interleaved (SU_PUNCH1-3, SU_VELOCITY1-3)
        // Punch angle causes view kick when firing weapons
        // Velocity is encoded as signed char * 16 (original: cl.mvelocity[0][i] = MSG_ReadChar() * 16)
        if (bits & 0x0004) {
            this.punchangle.pitch = this.readMsgChar();
        } else {
            this.punchangle.pitch = 0;
        }
        if (bits & 0x0020) {
            this.mvelocity[0].x = this.readMsgChar() * 16;
        } else {
            this.mvelocity[0].x = 0;
        }
        if (bits & 0x0008) {
            this.punchangle.yaw = this.readMsgChar();
        } else {
            this.punchangle.yaw = 0;
        }
        if (bits & 0x0040) {
            this.mvelocity[0].y = this.readMsgChar() * 16;
        } else {
            this.mvelocity[0].y = 0;
        }
        if (bits & 0x0010) {
            this.punchangle.roll = this.readMsgChar();
        } else {
            this.punchangle.roll = 0;
        }
        if (bits & 0x0080) {
            this.mvelocity[0].z = this.readMsgChar() * 16;
        } else {
            this.mvelocity[0].z = 0;
        }

        // Items - ALWAYS sent regardless of SU_ITEMS flag (original code comment: "[always sent]")
        this.readMsgLong();

        // SU_ONGROUND (1<<10) and SU_INWATER (1<<11) are flags only, no data
        this.onGround = !!(bits & 0x0400);

        // SU_WEAPONFRAME (1<<12)
        if (bits & 0x1000) {
            this.stats[STAT.WEAPONFRAME] = this.readMsgByte();
        } else {
            this.stats[STAT.WEAPONFRAME] = 0;
        }

        // SU_ARMOR (1<<13)
        if (bits & 0x2000) {
            this.stats[STAT.ARMOR] = this.readMsgByte();
        }

        // SU_WEAPON (1<<14) - weapon model precache index
        if (bits & 0x4000) {
            this.stats[STAT.WEAPON] = this.readMsgByte();
        }

        // Always sent: health (short), ammo, shells, nails, rockets, cells (bytes), active weapon (byte)
        this.stats[STAT.HEALTH] = this.readMsgShort();
        this.stats[STAT.AMMO] = this.readMsgByte();
        this.stats[STAT.SHELLS] = this.readMsgByte();
        this.stats[STAT.NAILS] = this.readMsgByte();
        this.stats[STAT.ROCKETS] = this.readMsgByte();
        this.stats[STAT.CELLS] = this.readMsgByte();
        this.stats[STAT.ACTIVEWEAPON] = this.readMsgByte();
    }

    /**
     * Parse particle effect (svc_particle)
     * Original R_ParseParticleEffect from r_part.c:
     *   org = MSG_ReadCoord (3x)
     *   dir[i] = MSG_ReadChar * (1.0/16) (3x)
     *   count = MSG_ReadByte (255 means 1024)
     *   color = MSG_ReadByte
     *
     * Calls R_RunParticleEffect(org, dir, color, count)
     */
    parseParticle() {
        const x = this.readMsgCoord();
        const y = this.readMsgCoord();
        const z = this.readMsgCoord();

        // Direction is scaled by 1/16
        const dirX = this.readMsgChar() * (1.0 / 16);
        const dirY = this.readMsgChar() * (1.0 / 16);
        const dirZ = this.readMsgChar() * (1.0 / 16);

        let count = this.readMsgByte();
        const color = this.readMsgByte();

        // Original: if (count == 255) count = 1024
        if (count === 255) count = 1024;

        // Spawn particle effect
        const effects = this.game.renderer?.effects;
        if (effects) {
            // R_RunParticleEffect handles explosions (count=1024) differently
            if (count === 1024) {
                effects.explosion({ x, y, z });
            } else {
                // Regular particle effect (bullet impacts, etc.)
                effects.impact({ x, y, z }, { x: dirX, y: dirY, z: dirZ }, Math.min(count, 20));
            }
        }
    }

    /**
     * Parse spawn static entity
     * Static entities are level decorations (torches, barrels, etc.)
     * that never move and aren't networked after initial spawn
     */
    parseSpawnStatic() {
        const modelIndex = this.readMsgByte();
        const frame = this.readMsgByte();
        const colormap = this.readMsgByte();
        const skin = this.readMsgByte();

        // Data is INTERLEAVED: origin[i], angle[i] for i=0,1,2
        // See CL_ParseBaseline in cl_parse.c:499-503
        const x = this.readMsgCoord();
        const pitch = this.readMsgAngle();
        const y = this.readMsgCoord();
        const yaw = this.readMsgAngle();
        const z = this.readMsgCoord();
        const roll = this.readMsgAngle();

        // Store static entity for rendering
        this.staticEntities.push({
            modelIndex,
            frame,
            colormap,
            skin,
            origin: { x, y, z },
            angles: { pitch, yaw, roll }
        });
    }

    /**
     * Parse spawn baseline (entity initial state)
     * Based on CL_ParseBaseline in cl_parse.c
     */
    parseSpawnBaseline() {
        const entityNum = this.readMsgShort();
        const modelIndex = this.readMsgByte();
        const frame = this.readMsgByte();
        const colormap = this.readMsgByte();
        const skin = this.readMsgByte();

        // Data is INTERLEAVED: origin[i], angle[i] for i=0,1,2
        // See CL_ParseBaseline in cl_parse.c:499-503
        const x = this.readMsgCoord();
        const pitch = this.readMsgAngle();
        const y = this.readMsgCoord();
        const yaw = this.readMsgAngle();
        const z = this.readMsgCoord();
        const roll = this.readMsgAngle();

        // Get or create entity and set baseline
        let ent = this.entities.get(entityNum);
        if (!ent) {
            ent = {
                msg_origins: [
                    { x: 0, y: 0, z: 0 },
                    { x: 0, y: 0, z: 0 }
                ],
                msg_angles: [
                    { pitch: 0, yaw: 0, roll: 0 },
                    { pitch: 0, yaw: 0, roll: 0 }
                ],
                origin: { x: 0, y: 0, z: 0 },
                angles: { pitch: 0, yaw: 0, roll: 0 },
                baseline: {
                    origin: { x: 0, y: 0, z: 0 },
                    angles: { pitch: 0, yaw: 0, roll: 0 },
                    modelIndex: 0,
                    frame: 0,
                    colormap: 0,
                    skin: 0,
                    effects: 0
                },
                modelIndex: 0,
                frame: 0,
                colormap: 0,
                skin: 0,
                effects: 0,
                msgtime: 0,
                forcelink: true
            };
            this.entities.set(entityNum, ent);
        }

        // Set baseline values (used when update flags don't include the field)
        ent.baseline.origin = { x, y, z };
        ent.baseline.angles = { pitch, yaw, roll };
        ent.baseline.modelIndex = modelIndex;
        ent.baseline.frame = frame;
        ent.baseline.colormap = colormap;
        ent.baseline.skin = skin;

        // Initialize current values from baseline
        ent.msg_origins[0] = { x, y, z };
        ent.msg_origins[1] = { x, y, z };
        ent.msg_angles[0] = { pitch, yaw, roll };
        ent.msg_angles[1] = { pitch, yaw, roll };
        ent.origin = { x, y, z };
        ent.angles = { pitch, yaw, roll };
        ent.modelIndex = modelIndex;
        ent.frame = frame;
        ent.colormap = colormap;
        ent.skin = skin;
    }

    /**
     * Parse temporary entity (explosions, etc.)
     * Based on CL_ParseTEnt in cl_tent.c
     */
    parseTempEntity() {
        const type = this.readMsgByte();
        const effects = this.game.renderer?.effects;

        let pos, pos2;

        switch (type) {
            case 0:  // TE_SPIKE - spike hit wall
            case 1:  // TE_SUPERSPIKE - super spike hit wall
                pos = {
                    x: this.readMsgCoord(),
                    y: this.readMsgCoord(),
                    z: this.readMsgCoord()
                };
                if (effects) {
                    effects.impact(pos, null, type === 1 ? 10 : 5);
                }
                if (this.game.audio) {
                    this.game.audio.playPositioned('sound/weapons/tink1.wav', pos, 1.0, 1.0);
                }
                break;

            case 2:  // TE_GUNSHOT - bullet hit wall
                pos = {
                    x: this.readMsgCoord(),
                    y: this.readMsgCoord(),
                    z: this.readMsgCoord()
                };
                if (effects) {
                    effects.impact(pos, null, 5);
                }
                if (this.game.audio) {
                    const ricSounds = ['sound/weapons/ric1.wav', 'sound/weapons/ric2.wav', 'sound/weapons/ric3.wav'];
                    const ric = ricSounds[Math.floor(Math.random() * 3)];
                    this.game.audio.playPositioned(ric, pos, 1.0, 1.0);
                }
                break;

            case 7:  // TE_WIZSPIKE - wizard spike
            case 8:  // TE_KNIGHTSPIKE - knight spike
                pos = {
                    x: this.readMsgCoord(),
                    y: this.readMsgCoord(),
                    z: this.readMsgCoord()
                };
                if (effects) {
                    effects.impact(pos, null, 8);
                }
                break;

            case 3:  // TE_EXPLOSION - rocket explosion
                pos = {
                    x: this.readMsgCoord(),
                    y: this.readMsgCoord(),
                    z: this.readMsgCoord()
                };
                if (effects) {
                    effects.explosion(pos);
                }
                if (this.game.audio) {
                    this.game.audio.playPositioned('sound/weapons/r_exp3.wav', pos, 1.0, 0.5);
                }
                break;

            case 4:  // TE_TAREXPLOSION - tarbaby explosion (R_BlobExplosion)
                pos = {
                    x: this.readMsgCoord(),
                    y: this.readMsgCoord(),
                    z: this.readMsgCoord()
                };
                if (effects) {
                    // Use blob explosion for tarbaby death
                    effects.blobExplosion(pos);
                }
                if (this.game.audio) {
                    this.game.audio.playPositioned('sound/weapons/r_exp3.wav', pos, 1.0, 0.5);
                }
                break;

            case 10: // TE_LAVASPLASH (R_LavaSplash)
                pos = {
                    x: this.readMsgCoord(),
                    y: this.readMsgCoord(),
                    z: this.readMsgCoord()
                };
                if (effects) {
                    // Use proper lava splash effect
                    effects.lavaSplash(pos);
                }
                break;

            case 11: // TE_TELEPORT
                pos = {
                    x: this.readMsgCoord(),
                    y: this.readMsgCoord(),
                    z: this.readMsgCoord()
                };
                if (effects) {
                    effects.teleportSplash(pos);
                }
                if (this.game.audio) {
                    this.game.audio.playPositioned('sound/misc/r_tele1.wav', pos, 1.0, 0.5);
                }
                break;

            case 12: // TE_EXPLOSION2 - colored explosion
                pos = {
                    x: this.readMsgCoord(),
                    y: this.readMsgCoord(),
                    z: this.readMsgCoord()
                };
                this.readMsgByte();  // colorStart
                this.readMsgByte();  // colorLength
                if (effects) {
                    effects.explosion(pos);
                }
                break;

            case 5:  // TE_LIGHTNING1 - shambler lightning
            case 6:  // TE_LIGHTNING2 - wizard lightning
            case 9:  // TE_LIGHTNING3 - player lightning gun
            case 13: // TE_BEAM - grappling hook beam
                this.readMsgShort();  // entity
                pos = {
                    x: this.readMsgCoord(),
                    y: this.readMsgCoord(),
                    z: this.readMsgCoord()
                };
                pos2 = {
                    x: this.readMsgCoord(),
                    y: this.readMsgCoord(),
                    z: this.readMsgCoord()
                };
                if (effects) {
                    effects.lightningBeam(pos, pos2);
                }
                // Play lightning hit sound (not for TE_BEAM which is grapple)
                if (this.game.audio && type !== 13) {
                    this.game.audio.playPositioned('sound/weapons/lhit.wav', pos, 1.0, 1.0);
                }
                break;
        }
    }

    /**
     * Parse fast entity update (U_SIGNAL bit is set in cmd)
     * Based on CL_ParseUpdate in cl_parse.c
     *
     * Quake protocol flags:
     * U_MOREBITS    (1<<0)  - more flag bits follow
     * U_ORIGIN1     (1<<1)  - origin x
     * U_ORIGIN2     (1<<2)  - origin y
     * U_ORIGIN3     (1<<3)  - origin z
     * U_ANGLE2      (1<<4)  - angle yaw
     * U_NOLERP      (1<<5)  - don't interpolate
     * U_FRAME       (1<<6)  - frame number
     * U_SIGNAL      (1<<7)  - marks as entity update (always set)
     * U_ANGLE1      (1<<8)  - angle pitch
     * U_ANGLE3      (1<<9)  - angle roll
     * U_MODEL       (1<<10) - model index
     * U_COLORMAP    (1<<11) - colormap
     * U_SKIN        (1<<12) - skin
     * U_EFFECTS     (1<<13) - effects
     * U_LONGENTITY  (1<<14) - entity number is short
     */
    parseFastUpdate(cmd) {
        let bits = cmd;

        // U_MOREBITS (bit 0) - read additional flag byte
        if (bits & 0x01) {
            bits |= this.readMsgByte() << 8;
        }

        // Read entity number
        let entityNum;
        if (bits & 0x4000) {  // U_LONGENTITY
            entityNum = this.readMsgShort() & 0xFFFF;
        } else {
            entityNum = this.readMsgByte();
        }

        // Get or create entity with dual-buffer structure
        let ent = this.entities.get(entityNum);
        if (!ent) {
            ent = {
                // Dual buffer for interpolation (like msg_origins/msg_angles in original)
                msg_origins: [
                    { x: 0, y: 0, z: 0 },
                    { x: 0, y: 0, z: 0 }
                ],
                msg_angles: [
                    { pitch: 0, yaw: 0, roll: 0 },
                    { pitch: 0, yaw: 0, roll: 0 }
                ],
                // Interpolated values (like ent->origin, ent->angles in original)
                origin: { x: 0, y: 0, z: 0 },
                angles: { pitch: 0, yaw: 0, roll: 0 },
                // Baseline values (default when flags not set)
                baseline: {
                    origin: { x: 0, y: 0, z: 0 },
                    angles: { pitch: 0, yaw: 0, roll: 0 },
                    modelIndex: 0,
                    frame: 0,
                    colormap: 0,
                    skin: 0,
                    effects: 0
                },
                // Current values for rendering
                modelIndex: 0,
                frame: 0,
                colormap: 0,
                skin: 0,
                effects: 0,
                msgtime: 0,
                forcelink: true
            };
            this.entities.set(entityNum, ent);
        }

        // Check if entity was updated last message (like original: ent->msgtime != cl.mtime[1])
        const forcelink = (ent.msgtime !== this.mtime[1]);
        ent.msgtime = this.mtime[0];

        // Shift origins and angles for interpolation (like original CL_ParseUpdate)
        // VectorCopy(ent->msg_origins[0], ent->msg_origins[1]);
        // VectorCopy(ent->msg_angles[0], ent->msg_angles[1]);
        ent.msg_origins[1] = { ...ent.msg_origins[0] };
        ent.msg_angles[1] = { ...ent.msg_angles[0] };

        // Read fields based on flags - store values for rendering
        if (bits & 0x0400) {  // U_MODEL (bit 10)
            ent.modelIndex = this.readMsgByte();
        } else {
            ent.modelIndex = ent.baseline.modelIndex;
        }
        if (bits & 0x0040) {  // U_FRAME (bit 6)
            ent.frame = this.readMsgByte();
        } else {
            ent.frame = ent.baseline.frame;
        }
        if (bits & 0x0800) {  // U_COLORMAP (bit 11)
            ent.colormap = this.readMsgByte();
        } else {
            ent.colormap = ent.baseline.colormap;
        }
        if (bits & 0x1000) {  // U_SKIN (bit 12)
            ent.skin = this.readMsgByte();
        } else {
            ent.skin = ent.baseline.skin;
        }
        if (bits & 0x2000) {  // U_EFFECTS (bit 13)
            ent.effects = this.readMsgByte();
        } else {
            ent.effects = ent.baseline.effects;
        }

        // Origin and angles - MUST be interleaved like original Quake protocol!
        // Order: origin1, angle1, origin2, angle2, origin3, angle3
        if (bits & 0x0002) {  // U_ORIGIN1
            ent.msg_origins[0].x = this.readMsgCoord();
        } else {
            ent.msg_origins[0].x = ent.baseline.origin.x;
        }
        if (bits & 0x0100) {  // U_ANGLE1 (pitch)
            ent.msg_angles[0].pitch = this.readMsgAngle();
        } else {
            ent.msg_angles[0].pitch = ent.baseline.angles.pitch;
        }

        if (bits & 0x0004) {  // U_ORIGIN2
            ent.msg_origins[0].y = this.readMsgCoord();
        } else {
            ent.msg_origins[0].y = ent.baseline.origin.y;
        }
        if (bits & 0x0010) {  // U_ANGLE2 (yaw)
            ent.msg_angles[0].yaw = this.readMsgAngle();
        } else {
            ent.msg_angles[0].yaw = ent.baseline.angles.yaw;
        }

        if (bits & 0x0008) {  // U_ORIGIN3
            ent.msg_origins[0].z = this.readMsgCoord();
        } else {
            ent.msg_origins[0].z = ent.baseline.origin.z;
        }
        if (bits & 0x0200) {  // U_ANGLE3 (roll)
            ent.msg_angles[0].roll = this.readMsgAngle();
        } else {
            ent.msg_angles[0].roll = ent.baseline.angles.roll;
        }

        // U_NOLERP (bit 5) - force no interpolation
        if (bits & 0x0020) {
            ent.forcelink = true;
        }

        // If entity wasn't in last message, force link (no lerp from)
        if (forcelink) {
            // Copy new origins to old so no interpolation on first frame
            ent.msg_origins[1] = { ...ent.msg_origins[0] };
            ent.msg_angles[1] = { ...ent.msg_angles[0] };
            ent.origin = { ...ent.msg_origins[0] };
            ent.angles = { ...ent.msg_angles[0] };
            ent.forcelink = true;
        }
    }

    // === Binary readers for message data ===

    readMsgByte() {
        if (this.msgOffset >= this.msgSize) return 0;
        return this.msgData[this.msgOffset++];
    }

    readMsgChar() {
        const b = this.readMsgByte();
        return b > 127 ? b - 256 : b;
    }

    readMsgShort() {
        const lo = this.readMsgByte();
        const hi = this.readMsgByte();
        let val = lo | (hi << 8);
        if (val > 32767) val -= 65536;
        return val;
    }

    readMsgLong() {
        const b0 = this.readMsgByte();
        const b1 = this.readMsgByte();
        const b2 = this.readMsgByte();
        const b3 = this.readMsgByte();
        return b0 | (b1 << 8) | (b2 << 16) | (b3 << 24);
    }

    readMsgFloat() {
        const bytes = new Uint8Array(4);
        for (let i = 0; i < 4; i++) {
            bytes[i] = this.readMsgByte();
        }
        const view = new DataView(bytes.buffer);
        return view.getFloat32(0, true);
    }

    readMsgString() {
        let str = '';
        while (this.msgOffset < this.msgSize) {
            const c = this.msgData[this.msgOffset++];
            if (c === 0) break;
            str += String.fromCharCode(c);
        }
        return str;
    }

    readMsgCoord() {
        // Quake coords are shorts * 0.125
        return this.readMsgShort() * 0.125;
    }

    readMsgAngle() {
        // Quake angles are bytes * (360/256)
        return this.readMsgByte() * (360.0 / 256.0);
    }

    // === Binary readers for demo header ===

    readInt32() {
        if (this.offset + 4 > this.data.length) return -1;
        const val = this.data[this.offset] |
                   (this.data[this.offset + 1] << 8) |
                   (this.data[this.offset + 2] << 16) |
                   (this.data[this.offset + 3] << 24);
        this.offset += 4;
        return val;
    }

    readFloat() {
        if (this.offset + 4 > this.data.length) return 0;
        const bytes = this.data.slice(this.offset, this.offset + 4);
        this.offset += 4;
        const view = new DataView(bytes.buffer);
        return view.getFloat32(0, true);
    }

    /**
     * Get current camera position/angles for rendering
     */
    /**
     * Get current camera position/angles for rendering
     * Includes all view state needed for V_CalcRefdef
     */
    getViewState() {
        return {
            origin: this.viewOrigin,
            angles: this.viewAngles,
            velocity: this.velocity,       // For view bob calculation
            punchangle: this.punchangle,   // Weapon kick
            viewHeight: this.viewHeight,   // Eye height
            onGround: this.onGround        // For landing effects
        };
    }

    isPlaying() {
        return this.playing && !this.paused;
    }
}
