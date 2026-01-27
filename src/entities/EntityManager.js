/**
 * EntityManager - Entity pool and lifecycle management
 *
 * Handles creation, updates, and cleanup of game entities.
 * Uses a pool-based allocation system like original Quake.
 */

const MAX_ENTITIES = 600;

export class EntityManager {
    constructor(game) {
        this.game = game;

        // Entity pool
        this.entities = [];
        this.freeList = [];

        // Entity categories for efficient iteration
        this.players = [];
        this.monsters = [];
        this.items = [];
        this.projectiles = [];
        this.triggers = [];
        this.funcs = [];

        // Pre-allocate entity slots
        for (let i = 0; i < MAX_ENTITIES; i++) {
            const entity = this.createEmptyEntity(i);
            this.entities.push(entity);
            this.freeList.push(i);
        }
    }

    createEmptyEntity(id) {
        return {
            id: id,
            active: false,
            classname: '',

            // Transform
            position: { x: 0, y: 0, z: 0 },
            angles: { pitch: 0, yaw: 0, roll: 0 },
            velocity: { x: 0, y: 0, z: 0 },

            // Physics
            moveType: 'none',
            solid: 'not',
            hull: null,
            onGround: false,
            groundEntity: null,

            // Model
            model: null,
            mesh: null,
            frame: 0,
            skin: 0,

            // Gameplay
            health: 0,
            maxHealth: 0,
            armor: 0,
            items: 0,
            weapons: 0,
            currentWeapon: 0,
            ammo: {},

            // AI
            enemy: null,
            goalEntity: null,
            thinkTime: 0,
            nextThink: 0,
            state: 'idle',

            // Callbacks
            think: null,
            touch: null,
            use: null,
            blocked: null,
            die: null,

            // Sound
            sounds: {},

            // Misc
            targetname: '',
            target: '',
            message: '',
            spawnflags: 0,

            // Custom data
            data: {}
        };
    }

    spawn() {
        if (this.freeList.length === 0) {
            console.error('Entity limit reached!');
            return null;
        }

        const id = this.freeList.pop();
        const entity = this.entities[id];

        // Reset entity
        Object.assign(entity, this.createEmptyEntity(id));
        entity.id = id;
        entity.active = true;

        return entity;
    }

    remove(entity) {
        if (!entity || !entity.active) return;

        // Remove from category lists
        this.removeFromCategory(entity);

        // Remove mesh from scene and dispose materials
        if (entity.mesh && this.game.renderer) {
            this.game.renderer.removeFromScene(entity.mesh);
            // Dispose material for sprites (projectiles)
            if (entity.mesh.material) {
                entity.mesh.material.dispose();
            }
        }

        // Mark as inactive
        entity.active = false;
        entity.classname = '';

        // Return to free list
        this.freeList.push(entity.id);
    }

    addToCategory(entity) {
        switch (entity.category) {
            case 'player':
                this.players.push(entity);
                break;
            case 'monster':
                this.monsters.push(entity);
                break;
            case 'item':
                this.items.push(entity);
                break;
            case 'projectile':
                this.projectiles.push(entity);
                break;
            case 'trigger':
                this.triggers.push(entity);
                break;
            case 'func':
                this.funcs.push(entity);
                break;
        }
    }

    removeFromCategory(entity) {
        let list;
        switch (entity.category) {
            case 'player': list = this.players; break;
            case 'monster': list = this.monsters; break;
            case 'item': list = this.items; break;
            case 'projectile': list = this.projectiles; break;
            case 'trigger': list = this.triggers; break;
            case 'func': list = this.funcs; break;
            default: return;
        }

        const index = list.indexOf(entity);
        if (index >= 0) {
            list.splice(index, 1);
        }
    }

    findByClassname(classname) {
        return this.entities.filter(e => e.active && e.classname === classname);
    }

    findByTargetname(targetname) {
        return this.entities.find(e => e.active && e.targetname === targetname);
    }

    findTargets(entity) {
        if (!entity.target) return [];
        return this.entities.filter(e => e.active && e.targetname === entity.target);
    }

    update(deltaTime, time) {
        for (const entity of this.entities) {
            if (!entity.active) continue;

            // Run think function
            if (entity.think && time >= entity.nextThink) {
                entity.think(entity, this.game, deltaTime);
            }
        }

        // Update func entities (doors, platforms, etc.) every frame
        for (const func of this.funcs) {
            if (!func.active) continue;
            if (func.think) {
                func.think(func, this.game, deltaTime);
            }
        }

        // Update projectile visuals
        for (const projectile of this.projectiles) {
            if (!projectile.active) continue;
            if (projectile.updateVisual) {
                projectile.updateVisual(projectile);
            }
        }
    }

    // Touch checking between entities
    checkTouches(entity) {
        if (!entity.active || entity.solid === 'not') return;

        for (const other of this.entities) {
            if (!other.active || other === entity || other.solid === 'not') continue;

            if (this.entitiesOverlap(entity, other)) {
                if (entity.touch) {
                    entity.touch(entity, other, this.game);
                }
                if (other.touch) {
                    other.touch(other, entity, this.game);
                }
            }
        }
    }

    /**
     * SV_TouchLinks - Check if entity overlaps any triggers or func entities with touch callbacks.
     * Called after entity movement completes (player, monsters, projectiles).
     * In original Quake (sv_phys.c), this walks the areanode BSP tree.
     * We use flat iteration over trigger and func entity lists.
     */
    touchTriggers(entity) {
        if (!entity || !entity.active) return;

        // Check trigger entities (trigger_once, trigger_multiple, trigger_hurt, etc.)
        for (let i = 0; i < this.triggers.length; i++) {
            const trigger = this.triggers[i];
            if (!trigger.active || !trigger.touch) continue;
            if (trigger === entity) continue;
            if (trigger.solid !== 'trigger') continue;

            if (this.entitiesOverlap(entity, trigger)) {
                trigger.touch(trigger, entity, this.game);
            }
        }

        // Check func entities with touch callbacks (doors, buttons)
        for (let i = 0; i < this.funcs.length; i++) {
            const func = this.funcs[i];
            if (!func.active || !func.touch) continue;
            if (func === entity) continue;

            if (this.entitiesOverlap(entity, func)) {
                func.touch(func, entity, this.game);
            }
        }
    }

    entitiesOverlap(a, b) {
        const aHull = a.hull || { mins: { x: -16, y: -16, z: -24 }, maxs: { x: 16, y: 16, z: 32 } };
        const bHull = b.hull || { mins: { x: -16, y: -16, z: -24 }, maxs: { x: 16, y: 16, z: 32 } };

        // AABB overlap test
        const aMin = {
            x: a.position.x + aHull.mins.x,
            y: a.position.y + aHull.mins.y,
            z: a.position.z + aHull.mins.z
        };
        const aMax = {
            x: a.position.x + aHull.maxs.x,
            y: a.position.y + aHull.maxs.y,
            z: a.position.z + aHull.maxs.z
        };
        const bMin = {
            x: b.position.x + bHull.mins.x,
            y: b.position.y + bHull.mins.y,
            z: b.position.z + bHull.mins.z
        };
        const bMax = {
            x: b.position.x + bHull.maxs.x,
            y: b.position.y + bHull.maxs.y,
            z: b.position.z + bHull.maxs.z
        };

        return (
            aMin.x <= bMax.x && aMax.x >= bMin.x &&
            aMin.y <= bMax.y && aMax.y >= bMin.y &&
            aMin.z <= bMax.z && aMax.z >= bMin.z
        );
    }

    // Get entities near a point
    findInRadius(center, radius) {
        const radiusSq = radius * radius;
        const result = [];

        for (const entity of this.entities) {
            if (!entity.active) continue;

            const dx = entity.position.x - center.x;
            const dy = entity.position.y - center.y;
            const dz = entity.position.z - center.z;
            const distSq = dx * dx + dy * dy + dz * dz;

            if (distSq <= radiusSq) {
                result.push({ entity, distanceSq: distSq });
            }
        }

        return result.sort((a, b) => a.distanceSq - b.distanceSq);
    }

    getActiveCount() {
        return this.entities.filter(e => e.active).length;
    }

    getCategory(category) {
        switch (category) {
            case 'player': return this.players;
            case 'monster': return this.monsters;
            case 'item': return this.items;
            case 'projectile': return this.projectiles;
            case 'trigger': return this.triggers;
            case 'func': return this.funcs;
            default: return [];
        }
    }
}
