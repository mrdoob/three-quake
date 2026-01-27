import { BSPCollision } from './BSPCollision.js';
import { PlayerMovement } from './PlayerMovement.js';

/**
 * Physics - Main physics integration
 *
 * Constants from Quake:
 * sv_friction: 4
 * sv_accelerate: 10
 * sv_maxspeed: 320
 * sv_gravity: 800
 * STEPSIZE: 18
 */

export const PHYSICS = {
    GRAVITY: 800,
    FRICTION: 4,
    ACCELERATE: 10,
    MAX_SPEED: 320,
    STEP_SIZE: 18,
    STOP_SPEED: 100,
    JUMP_VELOCITY: 270,  // Original Quake jump velocity
    MAX_VELOCITY: 2000,

    // Hull sizes
    HULL_PLAYER: {
        mins: { x: -16, y: -16, z: -24 },
        maxs: { x: 16, y: 16, z: 32 }
    },
    HULL_POINT: {
        mins: { x: 0, y: 0, z: 0 },
        maxs: { x: 0, y: 0, z: 0 }
    }
};

export class Physics {
    constructor(bsp, game) {
        this.bsp = bsp;
        this.game = game;
        this.collision = new BSPCollision(bsp);
        this.playerMovement = new PlayerMovement(this);

        // Entity list for physics simulation
        this.entities = [];
    }

    addEntity(entity) {
        this.entities.push(entity);
    }

    removeEntity(entity) {
        const index = this.entities.indexOf(entity);
        if (index >= 0) {
            this.entities.splice(index, 1);
        }
    }

    update(deltaTime) {
        // Update all entities
        for (const entity of this.entities) {
            this.updateEntity(entity, deltaTime);
        }
    }

    updateEntity(entity, deltaTime) {
        switch (entity.moveType) {
            case 'walk':
                this.playerMovement.update(entity, deltaTime);
                break;

            case 'step':
                this.updateStep(entity, deltaTime);
                break;

            case 'toss':
                this.updateToss(entity, deltaTime);
                break;

            case 'fly':
                this.updateFly(entity, deltaTime);
                break;

            case 'bounce':
                this.updateBounce(entity, deltaTime);
                break;

            case 'none':
                // No movement
                break;
        }
    }

    updateStep(entity, deltaTime) {
        // Monster ground movement with step climbing (MOVETYPE_STEP from original Quake)
        // Apply gravity when not on ground
        if (!entity.onGround) {
            entity.velocity.z -= PHYSICS.GRAVITY * deltaTime;
        }

        // Apply friction when on ground (original Quake: sv_friction = 4)
        if (entity.onGround) {
            const speed = Math.sqrt(
                entity.velocity.x * entity.velocity.x +
                entity.velocity.y * entity.velocity.y
            );

            if (speed > 0) {
                // Quake friction formula: newspeed = speed - frametime * control * friction
                const control = Math.max(speed, PHYSICS.STOP_SPEED);
                let newspeed = speed - deltaTime * control * PHYSICS.FRICTION;

                if (newspeed < 0) newspeed = 0;
                const scale = newspeed / speed;

                entity.velocity.x *= scale;
                entity.velocity.y *= scale;
            }
        }

        this.clampVelocity(entity.velocity);

        // Try to move
        const start = { ...entity.position };
        const end = {
            x: entity.position.x + entity.velocity.x * deltaTime,
            y: entity.position.y + entity.velocity.y * deltaTime,
            z: entity.position.z + entity.velocity.z * deltaTime
        };

        const hull = entity.hull || PHYSICS.HULL_PLAYER;
        let trace = this.traceLine(start, end, hull);

        if (trace.fraction < 1.0 && trace.plane && trace.plane.normal.z < 0.7) {
            // Hit a wall, try stepping up
            const stepStart = { x: start.x, y: start.y, z: start.z + PHYSICS.STEP_SIZE };
            const stepEnd = { x: end.x, y: end.y, z: end.z + PHYSICS.STEP_SIZE };

            const stepTrace = this.traceLine(stepStart, stepEnd, hull);

            if (stepTrace.fraction > trace.fraction) {
                // Step up worked, now trace down to find ground
                const downStart = stepTrace.endpos;
                const downEnd = { x: downStart.x, y: downStart.y, z: downStart.z - PHYSICS.STEP_SIZE - 1 };
                const downTrace = this.traceLine(downStart, downEnd, hull);

                entity.position.x = downTrace.endpos.x;
                entity.position.y = downTrace.endpos.y;
                entity.position.z = downTrace.endpos.z;

                entity.onGround = downTrace.fraction < 1.0 && downTrace.plane && downTrace.plane.normal.z > 0.7;
                return;
            }
        }

        // Normal movement
        entity.position.x = trace.endpos.x;
        entity.position.y = trace.endpos.y;
        entity.position.z = trace.endpos.z;

        // Check if on ground
        if (trace.fraction < 1.0 && trace.plane) {
            if (trace.plane.normal.z > 0.7) {
                entity.onGround = true;
                entity.velocity.z = 0;
            } else {
                // Slide along wall
                this.clipVelocity(entity.velocity, trace.plane.normal, 1.0);
            }
        } else {
            // Check ground below
            const groundTrace = this.traceLine(
                entity.position,
                { x: entity.position.x, y: entity.position.y, z: entity.position.z - 2 },
                hull
            );
            entity.onGround = groundTrace.fraction < 1.0 && groundTrace.plane && groundTrace.plane.normal.z > 0.7;
        }
    }

    updateToss(entity, deltaTime) {
        // Early return if already on ground (original Quake sv_phys.c FL_ONGROUND check)
        // Prevents double-movement of tossed items that have landed
        if (entity.onGround) return;

        // Apply gravity
        entity.velocity.z -= PHYSICS.GRAVITY * deltaTime;

        // Clamp velocity
        this.clampVelocity(entity.velocity);

        // Move and check for collisions
        const trace = this.move(entity, deltaTime);

        if (trace.fraction < 1.0) {
            // Hit something
            if (trace.plane) {
                // Check if it's the floor
                if (trace.plane.normal.z > 0.7) {
                    entity.onGround = true;
                    entity.velocity.z = 0;
                } else {
                    // Reflect velocity off wall
                    this.clipVelocity(entity.velocity, trace.plane.normal, 1.0);
                }
            }

            // Trigger touch callback for wall collision
            if (entity.touch) {
                entity.touch(entity, null, this.game, trace);
            }
        } else {
            entity.onGround = false;
        }
    }

    updateFly(entity, deltaTime) {
        // Flying entities don't have gravity
        this.clampVelocity(entity.velocity);

        const trace = this.move(entity, deltaTime);

        if (trace.fraction < 1.0 && trace.plane) {
            this.clipVelocity(entity.velocity, trace.plane.normal, 1.0);

            // Trigger touch callback for wall collision
            if (entity.touch) {
                entity.touch(entity, null, this.game, trace);
            }
        }
    }

    updateBounce(entity, deltaTime) {
        // Apply gravity
        entity.velocity.z -= PHYSICS.GRAVITY * deltaTime;
        this.clampVelocity(entity.velocity);

        const trace = this.move(entity, deltaTime);

        if (trace.fraction < 1.0 && trace.plane) {
            // Bounce off surface (overbounce = 1.5 for MOVETYPE_BOUNCE)
            this.clipVelocity(entity.velocity, trace.plane.normal, 1.5);

            // Check if on ground (normal.z > 0.7) and moving slowly
            // Original Quake: stop if velocity[2] < 60 after bounce on floor
            if (trace.plane.normal.z > 0.7) {
                if (entity.velocity.z < 60) {
                    entity.velocity.x = 0;
                    entity.velocity.y = 0;
                    entity.velocity.z = 0;
                    entity.moveType = 'none';
                    entity.onGround = true;
                }
            }

            // Trigger touch callback for wall collision
            if (entity.touch) {
                entity.touch(entity, null, this.game, trace);
            }
        }
    }

    move(entity, deltaTime) {
        const start = { ...entity.position };
        const end = {
            x: entity.position.x + entity.velocity.x * deltaTime,
            y: entity.position.y + entity.velocity.y * deltaTime,
            z: entity.position.z + entity.velocity.z * deltaTime
        };

        const hull = entity.hull || PHYSICS.HULL_POINT;
        const trace = this.traceLine(start, end, hull);

        // Update position
        entity.position.x = trace.endpos.x;
        entity.position.y = trace.endpos.y;
        entity.position.z = trace.endpos.z;

        return trace;
    }

    traceLine(start, end, hull = PHYSICS.HULL_POINT, sourceEntity = null) {
        // First trace against BSP world
        let trace = this.collision.trace(start, end, hull);

        // Then check against func entities (doors, platforms)
        if (this.game && this.game.entities && this.game.entities.funcs) {
            // Check collision with func entities
            const funcTrace = this.traceAgainstFuncEntities(start, end, hull, trace);
            if (funcTrace && funcTrace.fraction < trace.fraction) {
                trace = funcTrace;
            }

            // Proximity-based touch trigger for doors (simpler than ray-box)
            if (sourceEntity && sourceEntity.classname === 'player') {
                for (const func of this.game.entities.funcs) {
                    if (!func.active || !func.hull || !func.touch) continue;

                    // Calculate center of func entity
                    const centerX = func.position.x + (func.hull.mins.x + func.hull.maxs.x) / 2;
                    const centerY = func.position.y + (func.hull.mins.y + func.hull.maxs.y) / 2;
                    const centerZ = func.position.z + (func.hull.mins.z + func.hull.maxs.z) / 2;

                    const dx = sourceEntity.position.x - centerX;
                    const dy = sourceEntity.position.y - centerY;
                    const dz = sourceEntity.position.z - centerZ;
                    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

                    // Calculate trigger distance based on func size
                    const sizeX = func.hull.maxs.x - func.hull.mins.x;
                    const sizeY = func.hull.maxs.y - func.hull.mins.y;
                    const triggerDist = Math.max(sizeX, sizeY) / 2 + 48;

                    if (dist < triggerDist) {
                        func.touch(func, sourceEntity, this.game);
                    }
                }
            }
        }

        return trace;
    }

    traceAgainstFuncEntities(start, end, hull, worldTrace, sourceEntity = null) {
        if (!this.game.entities.funcs || this.game.entities.funcs.length === 0) return null;

        let bestTrace = worldTrace;

        for (const func of this.game.entities.funcs) {
            if (!func.active || !func.hull) continue;

            // Get func entity bounds in world space
            const funcMins = {
                x: func.position.x + func.hull.mins.x,
                y: func.position.y + func.hull.mins.y,
                z: func.position.z + func.hull.mins.z
            };
            const funcMaxs = {
                x: func.position.x + func.hull.maxs.x,
                y: func.position.y + func.hull.maxs.y,
                z: func.position.z + func.hull.maxs.z
            };

            // Expand bounds by player hull
            const expandedMins = {
                x: funcMins.x + hull.mins.x,
                y: funcMins.y + hull.mins.y,
                z: funcMins.z + hull.mins.z
            };
            const expandedMaxs = {
                x: funcMaxs.x + hull.maxs.x,
                y: funcMaxs.y + hull.maxs.y,
                z: funcMaxs.z + hull.maxs.z
            };

            // Ray-box intersection test
            const hitResult = this.rayBoxIntersect(start, end, expandedMins, expandedMaxs);
            if (hitResult && hitResult.fraction < bestTrace.fraction) {
                bestTrace = {
                    fraction: hitResult.fraction,
                    endpos: {
                        x: start.x + (end.x - start.x) * hitResult.fraction,
                        y: start.y + (end.y - start.y) * hitResult.fraction,
                        z: start.z + (end.z - start.z) * hitResult.fraction
                    },
                    plane: hitResult.plane,
                    allsolid: false,
                    startsolid: hitResult.startsolid || false,
                    entity: func
                };
            }

            // Also check if we're standing on top of this func entity (for ground detection)
            // This handles the case where hull trace starts exactly on the surface
            if (!hitResult && hull.mins && hull.mins.z < 0) {
                // Check if player feet are on top of this func entity
                const feetZ = start.z + hull.mins.z;
                const funcTop = funcMaxs.z;
                const onTop = Math.abs(feetZ - funcTop) < 2; // Within 2 units of top

                if (onTop) {
                    // Check horizontal overlap
                    const playerMinX = start.x + hull.mins.x;
                    const playerMaxX = start.x + hull.maxs.x;
                    const playerMinY = start.y + hull.mins.y;
                    const playerMaxY = start.y + hull.maxs.y;

                    const overlapsX = playerMinX < funcMaxs.x && playerMaxX > funcMins.x;
                    const overlapsY = playerMinY < funcMaxs.y && playerMaxY > funcMins.y;

                    if (overlapsX && overlapsY && bestTrace.fraction > 0) {
                        // Return immediate hit for ground detection
                        bestTrace = {
                            fraction: 0,
                            endpos: { ...start },
                            plane: { normal: { x: 0, y: 0, z: 1 } },
                            allsolid: false,
                            startsolid: false,
                            entity: func
                        };
                    }
                }
            }
        }

        return bestTrace;
    }

    rayBoxIntersect(start, end, mins, maxs) {
        const dir = {
            x: end.x - start.x,
            y: end.y - start.y,
            z: end.z - start.z
        };

        let tmin = 0;
        let tmax = 1;
        let hitNormal = null;

        // Check each axis
        const axes = ['x', 'y', 'z'];
        const normals = [
            { x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 },
            { x: 0, y: -1, z: 0 }, { x: 0, y: 1, z: 0 },
            { x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: 1 }
        ];

        for (let i = 0; i < 3; i++) {
            const axis = axes[i];
            if (Math.abs(dir[axis]) < 0.0001) {
                // Ray is parallel to slab
                if (start[axis] < mins[axis] || start[axis] > maxs[axis]) {
                    return null;
                }
            } else {
                const invD = 1.0 / dir[axis];
                let t1 = (mins[axis] - start[axis]) * invD;
                let t2 = (maxs[axis] - start[axis]) * invD;

                let normalIndex = i * 2;
                if (t1 > t2) {
                    const temp = t1;
                    t1 = t2;
                    t2 = temp;
                    normalIndex++;
                }

                if (t1 > tmin) {
                    tmin = t1;
                    hitNormal = normals[normalIndex];
                }
                tmax = Math.min(tmax, t2);

                if (tmin > tmax) {
                    return null;
                }
            }
        }

        // Check if we start inside the box (for ground detection when on platform)
        const startInside = start.x >= mins.x && start.x <= maxs.x &&
                           start.y >= mins.y && start.y <= maxs.y &&
                           start.z >= mins.z && start.z <= maxs.z;

        if (startInside) {
            // Starting inside - return immediate hit with upward normal (floor)
            return {
                fraction: 0,
                plane: { normal: { x: 0, y: 0, z: 1 } },  // Floor normal
                startsolid: true
            };
        }

        if (tmin >= 0 && tmin < 1) {
            return {
                fraction: Math.max(0, tmin - 0.001), // Small offset to avoid getting stuck
                plane: { normal: hitNormal }
            };
        }

        return null;
    }

    pointContents(point) {
        return this.collision.pointContents(point);
    }

    clipVelocity(velocity, normal, overbounce) {
        const backoff = (
            velocity.x * normal.x +
            velocity.y * normal.y +
            velocity.z * normal.z
        ) * overbounce;

        velocity.x -= normal.x * backoff;
        velocity.y -= normal.y * backoff;
        velocity.z -= normal.z * backoff;

        // Clamp to avoid tiny values
        if (Math.abs(velocity.x) < 0.1) velocity.x = 0;
        if (Math.abs(velocity.y) < 0.1) velocity.y = 0;
        if (Math.abs(velocity.z) < 0.1) velocity.z = 0;
    }

    /**
     * Clamp velocity per-axis (SV_CheckVelocity from sv_phys.c:90-114)
     *
     * Original Quake clamps each axis independently to ±sv_maxvelocity (2000),
     * NOT by total magnitude. This allows faster diagonal movement.
     */
    clampVelocity(velocity) {
        // Per-axis clamping like original Quake
        if (velocity.x > PHYSICS.MAX_VELOCITY) {
            velocity.x = PHYSICS.MAX_VELOCITY;
        } else if (velocity.x < -PHYSICS.MAX_VELOCITY) {
            velocity.x = -PHYSICS.MAX_VELOCITY;
        }

        if (velocity.y > PHYSICS.MAX_VELOCITY) {
            velocity.y = PHYSICS.MAX_VELOCITY;
        } else if (velocity.y < -PHYSICS.MAX_VELOCITY) {
            velocity.y = -PHYSICS.MAX_VELOCITY;
        }

        if (velocity.z > PHYSICS.MAX_VELOCITY) {
            velocity.z = PHYSICS.MAX_VELOCITY;
        } else if (velocity.z < -PHYSICS.MAX_VELOCITY) {
            velocity.z = -PHYSICS.MAX_VELOCITY;
        }
    }
}
