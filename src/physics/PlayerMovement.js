import { PHYSICS } from './Physics.js';
import { CONTENTS } from './BSPCollision.js';

/**
 * PlayerMovement - Quake-style player movement physics
 *
 * Implements the classic Quake movement including:
 * - Air control
 * - Ground acceleration/friction
 * - Step climbing
 * - Jump mechanics
 * - Water movement
 * - View roll
 */

// View roll constants (from Quake view.c)
const CL_ROLLANGLE = 2.0;   // Max camera roll in degrees
const CL_ROLLSPEED = 200;   // Velocity threshold for max roll

// Water constants
const WATER_SPEED_MULT = 0.7;  // Water speed is 70% of normal
const WATER_SINK_SPEED = 60;   // Drift down when idle (units/sec)

// Player flags
const FL_WATERJUMP = 2048;  // Player is jumping out of water

export class PlayerMovement {
    constructor(physics) {
        this.physics = physics;
        this.lastStepTrace = null; // Track last wall hit for wall friction
    }

    update(player, deltaTime) {
        // Don't process movement during intermission (original Quake behavior)
        if (this.physics.game && this.physics.game.intermissionRunning) {
            return;
        }

        // Check water level first
        this.checkWaterLevel(player);

        // Check ground state (but not if swimming)
        if (player.waterLevel < 2) {
            this.checkGround(player);
        } else {
            player.onGround = false;
        }

        // Handle water jump state
        if (player.flags & FL_WATERJUMP) {
            this.waterJump(player, deltaTime);
            return;
        }

        // Get wish velocity from input
        const wishDir = this.getWishDirection(player);
        const wishSpeed = this.getWishSpeed(player, wishDir);

        // Select movement mode based on water level
        if (player.waterLevel >= 2) {
            // In water (waist deep or more) - use water movement
            this.waterMove(player, deltaTime);
        } else if (player.onGround) {
            // Ground movement
            this.groundMove(player, wishDir, wishSpeed, deltaTime);
            // Use walkMove for proper stair stepping
            this.walkMove(player, deltaTime);
        } else {
            // Air movement
            this.airMove(player, wishDir, wishSpeed, deltaTime);
            // Just fly in the air
            this.flyMove(player, deltaTime);
        }

        // Calculate view roll
        this.calcViewRoll(player);

        // SV_TouchLinks - check trigger overlaps after movement
        if (this.physics.game && this.physics.game.entities) {
            this.physics.game.entities.touchTriggers(player);
        }
    }

    /**
     * Check water level at 3 points (feet, waist, eyes)
     * From SV_CheckWater in sv_phys.c
     */
    checkWaterLevel(player) {
        const point = { ...player.position };

        player.waterLevel = 0;
        player.waterType = CONTENTS.EMPTY;

        // Check feet (bottom of hull)
        point.z = player.position.z + PHYSICS.HULL_PLAYER.mins.z + 1;
        let contents = this.physics.pointContents(point);

        if (contents <= CONTENTS.WATER) {
            player.waterType = contents;
            player.waterLevel = 1;

            // Check waist (origin)
            point.z = player.position.z;
            contents = this.physics.pointContents(point);

            if (contents <= CONTENTS.WATER) {
                player.waterLevel = 2;

                // Check eyes (view height) - uses player.viewHeight like original ent->v.view_ofs[2]
                point.z = player.position.z + (player.viewHeight || 22);
                contents = this.physics.pointContents(point);

                if (contents <= CONTENTS.WATER) {
                    player.waterLevel = 3;
                }
            }
        }

        player.inWater = player.waterLevel > 0;
    }

    /**
     * SV_WaterMove - Movement while in water
     * From sv_user.c
     *
     * Original Quake: cmd.forwardmove/sidemove are in units (up to sv_maxspeed=320)
     * Our input is normalized (-1 to 1), so we must scale by MAX_SPEED
     */
    waterMove(player, deltaTime) {
        const input = player.input || { forward: 0, right: 0, up: 0 };

        // Scale normalized input to Quake units (like cmd.forwardmove/sidemove)
        const forwardMove = input.forward * PHYSICS.MAX_SPEED;
        const sideMove = input.right * PHYSICS.MAX_SPEED;
        const upMove = input.up * PHYSICS.MAX_SPEED;

        // Get view angles for movement direction (use pitch in water!)
        const yaw = player.angles.yaw * Math.PI / 180;
        const pitch = player.angles.pitch * Math.PI / 180;

        // Calculate forward vector (includes pitch for diving)
        const cosPitch = Math.cos(pitch);
        const forward = {
            x: Math.cos(yaw) * cosPitch,
            y: Math.sin(yaw) * cosPitch,
            z: -Math.sin(pitch)
        };

        const right = {
            x: Math.sin(yaw),
            y: -Math.cos(yaw),
            z: 0
        };

        // Calculate wish velocity (3D in water)
        // Original: wishvel[i] = forward[i]*cmd.forwardmove + right[i]*cmd.sidemove
        const wishVel = {
            x: forward.x * forwardMove + right.x * sideMove,
            y: forward.y * forwardMove + right.y * sideMove,
            z: forward.z * forwardMove
        };

        // Handle vertical movement
        // Original: if no input, wishvel[2] -= 60, else wishvel[2] += cmd.upmove
        if (!forwardMove && !sideMove && !upMove) {
            // Drift towards bottom when idle
            wishVel.z -= WATER_SINK_SPEED;
        } else {
            // Add up/down input (jump = up, crouch = down)
            wishVel.z += upMove;
        }

        // Calculate wish speed
        let wishSpeed = Math.sqrt(wishVel.x * wishVel.x + wishVel.y * wishVel.y + wishVel.z * wishVel.z);
        const maxSpeed = PHYSICS.MAX_SPEED * WATER_SPEED_MULT;

        if (wishSpeed > maxSpeed) {
            const scale = maxSpeed / wishSpeed;
            wishVel.x *= scale;
            wishVel.y *= scale;
            wishVel.z *= scale;
            wishSpeed = maxSpeed;
        }

        // Normalize wish direction
        const wishDir = { x: 0, y: 0, z: 0 };
        if (wishSpeed > 0) {
            wishDir.x = wishVel.x / wishSpeed;
            wishDir.y = wishVel.y / wishSpeed;
            wishDir.z = wishVel.z / wishSpeed;
        }

        // Apply water friction (proportional to speed)
        const speed = Math.sqrt(
            player.velocity.x * player.velocity.x +
            player.velocity.y * player.velocity.y +
            player.velocity.z * player.velocity.z
        );

        if (speed > 0) {
            let newSpeed = speed - deltaTime * speed * PHYSICS.FRICTION;
            if (newSpeed < 0) newSpeed = 0;
            const scale = newSpeed / speed;
            player.velocity.x *= scale;
            player.velocity.y *= scale;
            player.velocity.z *= scale;
        }

        // Accelerate in water
        if (wishSpeed > 0) {
            const currentSpeed = this.dotProduct(player.velocity, wishDir);
            const addSpeed = wishSpeed - currentSpeed;

            if (addSpeed > 0) {
                let accelSpeed = PHYSICS.ACCELERATE * wishSpeed * deltaTime;
                if (accelSpeed > addSpeed) accelSpeed = addSpeed;

                player.velocity.x += accelSpeed * wishDir.x;
                player.velocity.y += accelSpeed * wishDir.y;
                player.velocity.z += accelSpeed * wishDir.z;
            }
        }

        // Check for water jump (trying to get out)
        if (input.jump && player.waterLevel == 2) {
            this.checkWaterJump(player);
        }

        // Apply velocity
        this.flyMove(player, deltaTime);
    }

    /**
     * Check if player can jump out of water
     * From QuakeC PL_WaterJump
     */
    checkWaterJump(player) {
        // Must be moving forward
        const input = player.input || {};
        if (input.forward <= 0) return;

        // Already water jumping?
        if (player.flags & FL_WATERJUMP) return;

        // Trace forward from eye level
        const yaw = player.angles.yaw * Math.PI / 180;
        const forward = {
            x: Math.cos(yaw),
            y: Math.sin(yaw),
            z: 0
        };

        const start = {
            x: player.position.x,
            y: player.position.y,
            z: player.position.z + 8  // Slightly above center
        };

        const end = {
            x: start.x + forward.x * 24,
            y: start.y + forward.y * 24,
            z: start.z
        };

        // Check if there's a wall in front
        let trace = this.physics.traceLine(start, end, PHYSICS.HULL_POINT, player);
        if (trace.fraction < 1.0) {
            // There's a wall - check if there's air above it
            start.z = player.position.z + PHYSICS.HULL_PLAYER.maxs.z;
            end.x = start.x + forward.x * 24;
            end.y = start.y + forward.y * 24;
            end.z = start.z;

            trace = this.physics.traceLine(start, end, PHYSICS.HULL_POINT, player);
            if (trace.fraction === 1.0) {
                // Air above! Start water jump
                player.flags |= FL_WATERJUMP;
                player.velocity.z = 225; // Jump velocity
                player.waterJumpTime = 2.0; // Duration
                player.waterJumpDir = { ...forward };
            }
        }
    }

    /**
     * Handle water jump state
     */
    waterJump(player, deltaTime) {
        // Apply stored horizontal velocity
        if (player.waterJumpDir) {
            player.velocity.x = player.waterJumpDir.x * PHYSICS.MAX_SPEED;
            player.velocity.y = player.waterJumpDir.y * PHYSICS.MAX_SPEED;
        }

        // Count down timer
        player.waterJumpTime -= deltaTime;

        // End water jump when timer expires or we leave water
        if (player.waterJumpTime <= 0 || player.waterLevel === 0) {
            player.flags &= ~FL_WATERJUMP;
            player.waterJumpTime = 0;
        }

        // Still apply gravity and movement
        player.velocity.z -= PHYSICS.GRAVITY * deltaTime * 0.5; // Reduced gravity during jump
        this.flyMove(player, deltaTime);
    }

    /**
     * V_CalcRoll - Calculate view roll from velocity
     * From view.c
     */
    calcViewRoll(player) {
        // Get right vector from view angles
        const yaw = player.angles.yaw * Math.PI / 180;
        const right = {
            x: Math.sin(yaw),
            y: -Math.cos(yaw),
            z: 0
        };

        // Calculate velocity component along right vector (strafing speed)
        const side = player.velocity.x * right.x + player.velocity.y * right.y;

        // Calculate roll amount
        const sign = side < 0 ? -1 : 1;
        const absSide = Math.abs(side);

        let rollAmount;
        if (absSide < CL_ROLLSPEED) {
            // Linear ramp up
            rollAmount = (absSide / CL_ROLLSPEED) * CL_ROLLANGLE;
        } else {
            // Capped at max
            rollAmount = CL_ROLLANGLE;
        }

        // Store roll for renderer to use
        player.viewRoll = rollAmount * sign;
    }

    checkGround(player) {
        // Original Quake doesn't check velocity.z to determine ground state.
        // FL_ONGROUND is set during SV_FlyMove when hitting a floor surface,
        // and only cleared when jumping or actually leaving ground.
        //
        // We trace down to check for ground contact. If moving upward with
        // significant velocity (jumping), we skip the check to allow takeoff.
        // But small upward velocity (like sliding up a ramp) should still
        // count as on ground if there's ground beneath us.

        // Only skip ground check if clearly jumping (not just sliding up ramp)
        // Original Quake clears FL_ONGROUND when jump starts, not based on velocity
        if (player.jumping && player.velocity.z > 0) {
            player.onGround = false;
            player.groundEntity = null;
            return;
        }

        // Trace down from origin to check if standing on ground
        const start = { ...player.position };
        const end = {
            x: player.position.x,
            y: player.position.y,
            z: player.position.z - 1 // Short trace to detect ground
        };

        // Hull trace - the hull mins.z (-24) means feet level is checked
        const trace = this.physics.traceLine(start, end, PHYSICS.HULL_PLAYER, player);

        if (trace.fraction === 1.0 || !trace.plane) {
            player.onGround = false;
            player.groundEntity = null;
            return;
        }

        // Check if surface is walkable (not too steep)
        // Original Quake: trace.plane.normal[2] > 0.7
        if (trace.plane.normal.z < 0.7) {
            player.onGround = false;
            player.groundEntity = null;
            return;
        }

        player.onGround = true;
        // Store the actual entity if we hit one (func_plat, func_door, etc.)
        // Original Quake stores groundentity = EDICT_TO_PROG(trace.ent)
        player.groundEntity = trace.entity || null;

        // Store ground plane normal for ramp handling
        player.groundNormal = { ...trace.plane.normal };

        // Snap to ground when not jumping and on flat ground
        // Don't zero velocity.z on slopes - let flyMove handle the sliding
        if (!player.jumping && player.velocity.z <= 0) {
            // Only zero z velocity on nearly-flat ground (normal.z > 0.99)
            // On ramps, we need the z velocity from clipVelocity to slide up
            if (trace.plane.normal.z > 0.99) {
                player.velocity.z = 0;
            }
        }
    }

    getWishDirection(player) {
        const input = player.input || { forward: 0, right: 0, up: 0 };

        // Convert yaw to radians
        const yaw = player.angles.yaw * Math.PI / 180;

        // Calculate forward and right vectors
        const forward = {
            x: Math.cos(yaw),
            y: Math.sin(yaw),
            z: 0
        };

        const right = {
            x: Math.sin(yaw),
            y: -Math.cos(yaw),
            z: 0
        };

        // Combine into wish direction
        const wishDir = {
            x: forward.x * input.forward + right.x * input.right,
            y: forward.y * input.forward + right.y * input.right,
            z: 0
        };

        // Normalize
        const length = Math.sqrt(wishDir.x * wishDir.x + wishDir.y * wishDir.y);
        if (length > 0) {
            wishDir.x /= length;
            wishDir.y /= length;
        }

        return wishDir;
    }

    getWishSpeed(player, wishDir) {
        const input = player.input || { forward: 0, right: 0, up: 0 };

        // Calculate desired speed based on input magnitude
        const inputMag = Math.sqrt(
            input.forward * input.forward +
            input.right * input.right
        );

        return Math.min(inputMag, 1) * PHYSICS.MAX_SPEED;
    }

    groundMove(player, wishDir, wishSpeed, deltaTime) {
        // Apply friction
        this.applyFriction(player, deltaTime);

        // Accelerate
        this.accelerate(player, wishDir, wishSpeed, PHYSICS.ACCELERATE, deltaTime);

        // Handle jumping with frame limit (original Quake sv_user.c)
        // Can only jump if:
        // 1. Jump button is pressed
        // 2. Not already jumping (in air from a jump)
        // 3. Jump button was released since last jump (prevents bunnyhopping while holding)
        if (player.input && player.input.jump) {
            if (!player.jumping && player.jumpReleased !== false) {
                player.velocity.z = PHYSICS.JUMP_VELOCITY;
                player.onGround = false;
                player.jumping = true;
                player.jumpReleased = false; // Must release button before next jump
            }
        } else {
            // Jump button released - allow next jump
            player.jumpReleased = true;
        }
    }

    airMove(player, wishDir, wishSpeed, deltaTime) {
        // Apply gravity
        player.velocity.z -= PHYSICS.GRAVITY * deltaTime;

        // Air acceleration - pass both full wishSpeed and capped version
        // Original Quake SV_AirAccelerate has a quirk that enables bunnyhopping:
        // - addspeed uses wishspd (capped to 30)
        // - accelspeed uses wishspeed (global, full speed up to 320)
        this.airAccelerate(player, wishDir, wishSpeed, deltaTime);

        // Reset jump flag when falling
        if (player.velocity.z < 0) {
            player.jumping = false;
        }
    }

    airAccelerate(player, wishDir, wishSpeed, deltaTime) {
        // SV_AirAccelerate from Quake (sv_user.c:207-226)
        // Key bunnyhopping mechanic: wishspd is capped to 30 for addspeed,
        // but accelspeed uses the FULL wishspeed (320) - this is what
        // enables the classic Quake bunnyhopping technique.

        // wishspd capped to 30 (local variable in original)
        const wishspd = Math.min(wishSpeed, 30);

        // Calculate current speed in wish direction
        const currentSpeed =
            player.velocity.x * wishDir.x +
            player.velocity.y * wishDir.y;

        // Calculate how much to add (uses capped wishspd)
        const addSpeed = wishspd - currentSpeed;
        if (addSpeed <= 0) return;

        // Calculate acceleration rate (uses FULL wishSpeed - the bunnyhopping trick!)
        // Original: accelspeed = sv_accelerate.value * wishspeed * host_frametime
        let accelSpeed = PHYSICS.ACCELERATE * wishSpeed * deltaTime;
        if (accelSpeed > addSpeed) {
            accelSpeed = addSpeed;
        }

        // Apply acceleration
        player.velocity.x += accelSpeed * wishDir.x;
        player.velocity.y += accelSpeed * wishDir.y;
    }

    applyFriction(player, deltaTime) {
        const speed = Math.sqrt(
            player.velocity.x * player.velocity.x +
            player.velocity.y * player.velocity.y
        );

        if (speed < 1) {
            player.velocity.x = 0;
            player.velocity.y = 0;
            return;
        }

        // Check for edge friction (sv_user.c:122-160)
        // If leading edge is over a dropoff, increase friction by 2x
        let friction = PHYSICS.FRICTION;
        const edgeFriction = 2.0; // sv_edgefriction default value

        // Calculate point 16 units in front (in direction of movement)
        const start = {
            x: player.position.x + (player.velocity.x / speed) * 16,
            y: player.position.y + (player.velocity.y / speed) * 16,
            z: player.position.z + PHYSICS.HULL_PLAYER.mins.z // Feet level
        };
        const stop = {
            x: start.x,
            y: start.y,
            z: start.z - 34 // Trace 34 units down
        };

        // Trace to check for ground ahead
        const trace = this.physics.traceLine(start, stop, PHYSICS.HULL_POINT, player);
        if (trace.fraction === 1.0) {
            // No ground found - we're on an edge, apply extra friction
            friction = PHYSICS.FRICTION * edgeFriction;
        }

        // Calculate friction drop
        const control = speed < PHYSICS.STOP_SPEED ? PHYSICS.STOP_SPEED : speed;
        let drop = control * friction * deltaTime;

        // Scale velocity
        let newSpeed = speed - drop;
        if (newSpeed < 0) newSpeed = 0;
        newSpeed /= speed;

        player.velocity.x *= newSpeed;
        player.velocity.y *= newSpeed;
    }

    accelerate(player, wishDir, wishSpeed, accel, deltaTime) {
        // Calculate current speed in wish direction
        const currentSpeed =
            player.velocity.x * wishDir.x +
            player.velocity.y * wishDir.y;

        // Calculate how much to add
        const addSpeed = wishSpeed - currentSpeed;
        if (addSpeed <= 0) return;

        // Calculate acceleration
        let accelSpeed = accel * deltaTime * wishSpeed;
        if (accelSpeed > addSpeed) {
            accelSpeed = addSpeed;
        }

        // Apply acceleration
        player.velocity.x += accelSpeed * wishDir.x;
        player.velocity.y += accelSpeed * wishDir.y;
    }

    flyMove(player, deltaTime) {
        // Implementation of SV_FlyMove from Quake
        const originalVelocity = { ...player.velocity };
        const originalPosition = { ...player.position };
        let timeLeft = deltaTime;
        const numBumps = 4;
        let blocked = 0;

        const planes = [];

        for (let bump = 0; bump < numBumps; bump++) {
            if (timeLeft <= 0) break;

            // Calculate end position
            const end = {
                x: player.position.x + player.velocity.x * timeLeft,
                y: player.position.y + player.velocity.y * timeLeft,
                z: player.position.z + player.velocity.z * timeLeft
            };

            // Trace movement
            const trace = this.physics.traceLine(player.position, end, PHYSICS.HULL_PLAYER, player);

            if (trace.allsolid) {
                // Entity is trapped in another solid
                player.velocity.x = 0;
                player.velocity.y = 0;
                player.velocity.z = 0;
                return 3;
            }

            // Move as far as we can
            if (trace.fraction > 0) {
                player.position.x = trace.endpos.x;
                player.position.y = trace.endpos.y;
                player.position.z = trace.endpos.z;
            }

            if (trace.fraction === 1.0) {
                break; // Moved full distance
            }

            timeLeft -= timeLeft * trace.fraction;

            // Categorize the blocking plane
            if (trace.plane) {
                if (trace.plane.normal.z > 0.7) {
                    blocked |= 1; // floor
                    // Set ground state when landing on any floor surface
                    // Original Quake: ent->v.groundentity = EDICT_TO_PROG(trace.ent)
                    player.onGround = true;
                    player.groundEntity = trace.entity || null;
                    player.groundNormal = { ...trace.plane.normal };
                } else if (trace.plane.normal.z === 0) {
                    blocked |= 2; // step/wall
                    // Save step trace for wall friction
                    this.lastStepTrace = trace;
                } else {
                    // Steep slope (0 < normal.z <= 0.7) - treat as wall for stepping
                    // Original Quake doesn't explicitly handle this, but we need
                    // to allow step-up attempts for steep but short obstacles
                    blocked |= 2;
                    this.lastStepTrace = trace;
                }

                planes.push({ ...trace.plane });

                // Clip velocity to all accumulated planes
                this.clipToPlanes(player, planes, originalVelocity);

                // Check if velocity reversed direction (sv_phys.c:354-358)
                // Prevents oscillation on slopes
                const dot = player.velocity.x * originalVelocity.x +
                           player.velocity.y * originalVelocity.y +
                           player.velocity.z * originalVelocity.z;
                if (dot <= 0) {
                    player.velocity.x = 0;
                    player.velocity.y = 0;
                    player.velocity.z = 0;
                    return blocked;
                }
            }
        }

        return blocked;
    }

    // SV_WalkMove (sv_phys.c:958-1049) - handles stepping up stairs
    walkMove(player, deltaTime) {
        const originalPosition = { ...player.position };
        const originalVelocity = { ...player.velocity };

        // Clear onGround before flyMove (sv_phys.c:970-971)
        // It will be re-set by flyMove/trace results if appropriate
        const wasOnGround = player.onGround;
        player.onGround = false;

        // First, try a normal move
        let blocked = this.flyMove(player, deltaTime);

        // Apply wall friction if we hit a wall
        if (blocked & 2) {
            this.applyWallFriction(player, this.lastStepTrace);
        }

        // If we didn't hit a step (vertical wall), we're done
        if (!(blocked & 2)) {
            return;
        }

        // Don't stair-climb while jumping
        if (!player.onGround && player.velocity.z > 0) {
            return;
        }

        // Save the no-step result
        const noStepPosition = { ...player.position };
        const noStepVelocity = { ...player.velocity };

        // Restore original position and try stepping
        player.position = { ...originalPosition };
        player.velocity = { ...originalVelocity };

        // Push up by STEPSIZE
        const upMove = { x: 0, y: 0, z: PHYSICS.STEP_SIZE };
        const upTrace = this.pushEntity(player, upMove);

        // Move forward (horizontal only)
        player.velocity.x = originalVelocity.x;
        player.velocity.y = originalVelocity.y;
        player.velocity.z = 0;
        blocked = this.flyMove(player, deltaTime);

        // Check if we're stuck (didn't move)
        if (Math.abs(originalPosition.x - player.position.x) < 0.03125 &&
            Math.abs(originalPosition.y - player.position.y) < 0.03125) {
            // Try to unstick
            this.tryUnstick(player, originalVelocity);
        }

        // Push down to find the floor
        // Original: downmove[2] = -STEPSIZE + oldvel[2]*host_frametime
        // This accounts for falling velocity when stepping
        const downMove = {
            x: 0,
            y: 0,
            z: -PHYSICS.STEP_SIZE + originalVelocity.z * deltaTime
        };
        const downTrace = this.pushEntity(player, downMove);

        // Check if we landed on valid ground
        if (downTrace.plane && downTrace.plane.normal.z > 0.7) {
            // Successful step - keep this position
            player.velocity = { ...originalVelocity };
            player.velocity.z = 0;
            player.onGround = true;
        } else {
            // Step failed - revert to no-step result
            player.position = noStepPosition;
            player.velocity = noStepVelocity;
        }
    }

    pushEntity(player, move) {
        const end = {
            x: player.position.x + move.x,
            y: player.position.y + move.y,
            z: player.position.z + move.z
        };

        const trace = this.physics.traceLine(player.position, end, PHYSICS.HULL_PLAYER, player);

        player.position.x = trace.endpos.x;
        player.position.y = trace.endpos.y;
        player.position.z = trace.endpos.z;

        return trace;
    }

    tryUnstick(player, oldVelocity) {
        // SV_TryUnstick - try nudging in 8 directions to escape BSP issues
        const originalPosition = { ...player.position };
        const dirs = [
            { x: 2, y: 0 },
            { x: 0, y: 2 },
            { x: -2, y: 0 },
            { x: 0, y: -2 },
            { x: 2, y: 2 },
            { x: -2, y: 2 },
            { x: 2, y: -2 },
            { x: -2, y: -2 }
        ];

        for (const dir of dirs) {
            // Nudge position
            this.pushEntity(player, { x: dir.x, y: dir.y, z: 0 });

            // Try moving again
            player.velocity.x = oldVelocity.x;
            player.velocity.y = oldVelocity.y;
            player.velocity.z = 0;

            this.flyMove(player, 0.1);

            // Check if we made progress
            if (Math.abs(originalPosition.x - player.position.x) > 4 ||
                Math.abs(originalPosition.y - player.position.y) > 4) {
                return true; // Unstuck!
            }

            // Reset and try next direction
            player.position = { ...originalPosition };
        }

        // Still stuck
        player.velocity.x = 0;
        player.velocity.y = 0;
        player.velocity.z = 0;
        return false;
    }

    clipToPlanes(player, planes, originalVelocity) {
        // Clip velocity to all planes
        for (let i = 0; i < planes.length; i++) {
            this.physics.clipVelocity(player.velocity, planes[i].normal, 1.0);

            // Check if clipped velocity goes back into any plane
            let ok = true;
            for (let j = 0; j < planes.length; j++) {
                if (i !== j) {
                    const dot = player.velocity.x * planes[j].normal.x +
                                player.velocity.y * planes[j].normal.y +
                                player.velocity.z * planes[j].normal.z;
                    if (dot < 0) {
                        ok = false;
                        break;
                    }
                }
            }

            if (ok) {
                return;
            }
        }

        // Stuck in a corner
        if (planes.length === 2) {
            // Slide along the crease between two planes
            const dir = this.crossProduct(planes[0].normal, planes[1].normal);
            const d = this.dotProduct(dir, player.velocity);
            player.velocity.x = dir.x * d;
            player.velocity.y = dir.y * d;
            player.velocity.z = dir.z * d;
        } else {
            // Stop
            player.velocity.x = 0;
            player.velocity.y = 0;
            player.velocity.z = 0;
        }
    }

    crossProduct(v1, v2) {
        return {
            x: v1.y * v2.z - v1.z * v2.y,
            y: v1.z * v2.x - v1.x * v2.z,
            z: v1.x * v2.y - v1.y * v2.x
        };
    }

    dotProduct(v1, v2) {
        return v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
    }

    /**
     * SV_WallFriction - Apply extra friction when sliding along walls
     * This reduces velocity when moving into a wall at an angle
     */
    applyWallFriction(player, trace) {
        if (!trace || !trace.plane) return;

        // Calculate forward vector from player's view angle
        const yaw = player.angles.yaw * Math.PI / 180;
        const forward = {
            x: Math.cos(yaw),
            y: Math.sin(yaw),
            z: 0
        };

        // Calculate how much we're facing into the wall
        let d = this.dotProduct(trace.plane.normal, forward);

        d += 0.5;
        if (d >= 0) {
            return; // Not facing into wall enough
        }

        // Cut the tangential velocity
        const i = this.dotProduct(trace.plane.normal, player.velocity);
        const into = {
            x: trace.plane.normal.x * i,
            y: trace.plane.normal.y * i,
            z: trace.plane.normal.z * i
        };
        const side = {
            x: player.velocity.x - into.x,
            y: player.velocity.y - into.y,
            z: player.velocity.z - into.z
        };

        player.velocity.x = side.x * (1 + d);
        player.velocity.y = side.y * (1 + d);
        // Don't affect Z velocity for wall friction
    }
}
