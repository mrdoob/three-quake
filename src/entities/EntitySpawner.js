import { createMonster, MONSTER_TYPES, initializeMonsterPathing } from './Monster.js';
import { createItem, ITEM_TYPES } from '../game/Items.js';

/**
 * EntitySpawner - Creates entities from BSP entity lump
 */

// State constants matching original Quake
const STATE_TOP = 0;
const STATE_BOTTOM = 1;
const STATE_UP = 2;
const STATE_DOWN = 3;

// Trigger and func entities
const TRIGGER_TYPES = {
    'trigger_once': true,
    'trigger_multiple': true,
    'trigger_teleport': true,
    'trigger_secret': true,
    'trigger_hurt': true,
    'trigger_push': true,
    'trigger_changelevel': true,
    'trigger_setskill': true,
    'trigger_counter': true,
    'trigger_relay': true
};

const FUNC_TYPES = {
    'func_door': true,
    'func_door_secret': true,
    'func_button': true,
    'func_plat': true,
    'func_train': true,
    'func_wall': true,
    'func_rotating': true,
    'func_illusionary': true,
    // func_episodegate: Only spawns when episode IS completed (blocks re-entry).
    // Since we don't track serverflags/episode completion, don't spawn it.
    'func_bossgate': true  // Spawns when NOT all episodes completed (blocks final boss)
};

export class EntitySpawner {
    constructor(game) {
        this.game = game;
        this.bsp = null;
    }

    /**
     * Spawn entities from BSP entity lump
     * @param {Object} bsp - BSP data
     * @param {Object} options - Spawn options
     * @param {boolean} options.skipVisuals - Skip monsters and items (for demo mode)
     */
    async spawnEntities(bsp, options = {}) {
        this.bsp = bsp;
        const entities = bsp.entities;
        let spawnCount = 0;
        const skipVisuals = options.skipVisuals || false;

        // Collect monster spawn promises
        const monsterPromises = [];

        for (const entData of entities) {
            const classname = entData.classname;
            if (!classname) continue;

            // Skip worldspawn
            if (classname === 'worldspawn') {
                this.handleWorldspawn(entData);
                continue;
            }

            // Handle monsters asynchronously (skip in demo mode)
            if (MONSTER_TYPES[classname]) {
                if (!skipVisuals) {
                    const position = entData._origin || { x: 0, y: 0, z: 0 };
                    const angle = entData._angle || 0;
                    const angles = { pitch: 0, yaw: angle, roll: 0 };
                    monsterPromises.push(this.spawnMonster(classname, position, angles, entData));
                    spawnCount++;
                }
                continue;
            }

            // Skip items in demo mode (they come from demo protocol)
            if (skipVisuals && ITEM_TYPES[classname]) {
                continue;
            }

            const spawned = await this.spawnEntity(entData, { skipVisuals });
            if (spawned) {
                spawnCount++;
            }
        }

        // Wait for all monsters to spawn
        if (monsterPromises.length > 0) {
            await Promise.all(monsterPromises);
            console.log(`Spawned ${monsterPromises.length} monsters`);
        }

        // Initialize monster pathing after all entities (including path_corners) are spawned
        if (!skipVisuals) {
            initializeMonsterPathing(this.game);
        }

        console.log(`Spawned ${spawnCount} entities total${skipVisuals ? ' (demo mode - visuals skipped)' : ''}`);
    }

    handleWorldspawn(entData) {
        // Set level properties
        if (entData.message) {
            console.log(`Level: ${entData.message}`);
        }

        if (entData.wad) {
            console.log(`WAD files: ${entData.wad}`);
        }

        // Ambient sounds
        if (entData.sounds) {
            // Would set ambient CD track
        }
    }

    async spawnEntity(entData, options = {}) {
        const classname = entData.classname;
        const position = entData._origin || { x: 0, y: 0, z: 0 };
        const angle = entData._angle || 0;
        const angles = { pitch: 0, yaw: angle, roll: 0 };
        const skipVisuals = options.skipVisuals || false;

        // Check for monsters (skip in demo mode - handled by demo protocol)
        if (MONSTER_TYPES[classname]) {
            if (skipVisuals) return false;
            return await this.spawnMonster(classname, position, angles, entData);
        }

        // Check for items (skip in demo mode - handled by demo protocol)
        if (ITEM_TYPES[classname]) {
            if (skipVisuals) return false;
            return await this.spawnItem(classname, position, entData);
        }

        // Check for triggers
        if (TRIGGER_TYPES[classname]) {
            return this.spawnTrigger(classname, position, entData);
        }

        // Check for func entities
        if (FUNC_TYPES[classname]) {
            return this.spawnFunc(classname, position, entData);
        }

        // Handle other entity types
        switch (classname) {
            case 'info_player_start':
            case 'info_player_deathmatch':
            case 'info_player_coop':
            case 'info_player_start2':
                // Spawn points handled separately
                return null;

            case 'info_teleport_destination':
                return this.spawnTeleportDest(entData);

            case 'light':
            case 'light_fluoro':
            case 'light_fluorospark':
            case 'light_globe':
            case 'light_flame_large_yellow':
            case 'light_flame_small_yellow':
            case 'light_torch_small_walltorch':
                return await this.spawnLight(classname, position, entData);

            case 'ambient_suck_wind':
            case 'ambient_drone':
            case 'ambient_drip':
            case 'ambient_comp_hum':
            case 'ambient_swamp1':
            case 'ambient_swamp2':
                return this.spawnAmbient(classname, position, entData);

            case 'path_corner':
                return this.spawnPathCorner(entData);

            case 'misc_explobox':
            case 'misc_explobox2':
                return this.spawnExploBox(position, entData);

            default:
                // Unknown entity type
                // console.log(`Unknown entity: ${classname}`);
                return null;
        }
    }

    async spawnMonster(classname, position, angles, entData) {
        // Check spawnflags for difficulty
        const spawnflags = parseInt(entData.spawnflags) || 0;

        // Skill flags: 256 = not easy, 512 = not normal, 1024 = not hard/nightmare
        const skill = this.game.skill;
        if ((spawnflags & 256) && skill === 0) {
            // NOT_EASY flag set and we're on easy - don't spawn
            return null;
        }
        if ((spawnflags & 512) && skill === 1) {
            // NOT_NORMAL flag set and we're on normal - don't spawn
            return null;
        }
        if ((spawnflags & 1024) && skill >= 2) {
            // NOT_HARD flag set and we're on hard/nightmare - don't spawn
            return null;
        }

        const monster = await createMonster(
            this.game.entities,
            classname,
            position,
            angles,
            this.game
        );

        if (monster) {
            monster.targetname = entData.targetname || '';
            monster.target = entData.target || '';
            monster.spawnflags = spawnflags;
        }

        return monster;
    }

    async spawnItem(classname, position, entData) {
        // Check spawnflags for difficulty (items can also have skill flags)
        const spawnflags = parseInt(entData.spawnflags) || 0;
        const skill = this.game.skill;

        if ((spawnflags & 256) && skill === 0) return null;  // NOT_EASY
        if ((spawnflags & 512) && skill === 1) return null;  // NOT_NORMAL
        if ((spawnflags & 1024) && skill >= 2) return null;  // NOT_HARD

        // Check for large ammo box (spawnflag 1 = WEAPON_BIG in original items.qc)
        // Large boxes give more ammo: shells 40, nails 50, rockets 10, cells 12
        let effectiveClassname = classname;
        if (spawnflags & 1) {
            const largeVariants = {
                'item_shells': 'item_shells_large',
                'item_spikes': 'item_spikes_large',
                'item_rockets': 'item_rockets_large',
                'item_cells': 'item_cells_large'
            };
            if (largeVariants[classname]) {
                effectiveClassname = largeVariants[classname];
            }
        }

        const item = await createItem(
            this.game.entities,
            effectiveClassname,
            position,
            this.game
        );

        if (item) {
            item.targetname = entData.targetname || '';
            item.target = entData.target || '';
            item.spawnflags = spawnflags;
        }

        return item;
    }

    spawnTrigger(classname, position, entData) {
        const trigger = this.game.entities.spawn();
        if (!trigger) return null;

        trigger.classname = classname;
        trigger.category = 'trigger';
        trigger.position = { ...position };

        trigger.moveType = 'none';
        trigger.solid = 'trigger';

        // Triggers use brush models for their volume
        if (entData.model && entData.model.startsWith('*')) {
            const modelIndex = parseInt(entData.model.substring(1));
            trigger.data.modelIndex = modelIndex;

            // Extract bounds from BSP model
            const bspModel = this.bsp.models[modelIndex];
            if (bspModel) {
                trigger.hull = {
                    mins: { ...bspModel.mins },
                    maxs: { ...bspModel.maxs }
                };
                // Position is at model origin, hull is absolute in world space
                // Adjust hull to be relative to position (which is 0,0,0 for brush models)
                trigger.position = { x: 0, y: 0, z: 0 };
            }
        }

        trigger.targetname = entData.targetname || '';
        trigger.target = entData.target || '';
        trigger.killtarget = entData.killtarget || '';
        trigger.message = entData.message || '';
        trigger.spawnflags = parseInt(entData.spawnflags) || 0;

        // Wait time between re-triggers (original Quake default is 0.2 seconds)
        // A wait of -1 means trigger cannot be re-triggered (like trigger_once)
        trigger.data.wait = entData.wait !== undefined ? parseFloat(entData.wait) : 0.2;

        trigger.touch = (self, other, game) => {
            if (other.classname !== 'player') return;
            this.activateTrigger(self, other, game);
        };

        // Specific trigger setup
        switch (classname) {
            case 'trigger_once':
                trigger.data.fired = false;
                break;

            case 'trigger_teleport':
                trigger.data.teleportDest = entData.target;
                break;

            case 'trigger_hurt':
                trigger.data.damage = parseInt(entData.dmg) || 5;
                break;

            case 'trigger_push':
                trigger.data.pushSpeed = parseInt(entData.speed) || 1000;
                trigger.data.pushAngle = entData._angle || 0;
                break;

            case 'trigger_changelevel':
                trigger.data.nextMap = entData.map || '';
                break;

            case 'trigger_setskill':
                // message field contains skill level: 0=easy, 1=normal, 2=hard, 3=nightmare
                trigger.data.skill = parseInt(entData.message) || 0;
                break;

            case 'trigger_counter':
                // Activates after being triggered N times
                // count = number of triggers needed (default 2)
                trigger.data.count = parseInt(entData.count) || 2;
                trigger.data.currentCount = 0;
                // trigger_counter is typically targeted by other triggers, not touched
                trigger.touch = null;
                trigger.use = (self, activator, game) => {
                    self.data.currentCount++;
                    if (self.data.currentCount >= self.data.count) {
                        this.fireTargets(self, activator, game);
                        if (self.message) {
                            console.log(self.message);
                        }
                        // Reset if nomessage flag not set (spawnflag 1)
                        if (!(self.spawnflags & 1)) {
                            self.data.currentCount = 0;
                        }
                    }
                };
                break;

            case 'trigger_relay':
                // Fires targets after a delay
                // delay = time in seconds (default 0)
                trigger.data.delay = parseFloat(entData.delay) || 0;
                trigger.touch = null;
                trigger.use = (self, activator, game) => {
                    if (self.data.delay > 0) {
                        // Schedule delayed firing
                        self.data.pendingFire = game.time + self.data.delay;
                        self.data.pendingActivator = activator;
                    } else {
                        // Fire immediately
                        this.fireTargets(self, activator, game);
                        if (self.message) {
                            console.log(self.message);
                        }
                    }
                };
                trigger.think = (self, game, dt) => {
                    if (self.data.pendingFire && game.time >= self.data.pendingFire) {
                        this.fireTargets(self, self.data.pendingActivator, game);
                        if (self.message) {
                            console.log(self.message);
                        }
                        self.data.pendingFire = 0;
                        self.data.pendingActivator = null;
                    }
                };
                break;
        }

        this.game.entities.addToCategory(trigger);

        if (classname === 'trigger_teleport') {
            console.log(`Spawned trigger_teleport with target: ${trigger.data.teleportDest}, hull:`, trigger.hull);
        } else if (classname === 'trigger_changelevel') {
            console.log(`Spawned trigger_changelevel to map: ${trigger.data.nextMap}, hull:`, trigger.hull);
        }

        return trigger;
    }

    activateTrigger(trigger, activator, game) {
        // Check if already fired (for trigger_once)
        if (trigger.data.fired) return;

        switch (trigger.classname) {
            case 'trigger_once':
                trigger.data.fired = true;
                this.fireTargets(trigger, activator, game);
                if (trigger.message) {
                    console.log(trigger.message);
                }
                break;

            case 'trigger_multiple':
                // Use wait property for re-trigger delay (default 0.2s from triggers.qc)
                // wait of -1 means it acts like trigger_once
                if (trigger.data.wait === -1 && trigger.data.fired) return;
                if (game.time < (trigger.data.nextTrigger || 0)) return;

                trigger.data.fired = true;
                trigger.data.nextTrigger = game.time + (trigger.data.wait > 0 ? trigger.data.wait : 0.2);
                this.fireTargets(trigger, activator, game);
                break;

            case 'trigger_teleport':
                console.log(`Trigger teleport activated, target: ${trigger.data.teleportDest}`);
                // Fire targets/killtargets before teleporting (original Quake behavior)
                this.fireTargets(trigger, activator, game);
                this.teleportEntity(activator, trigger.data.teleportDest, game);
                break;

            case 'trigger_hurt':
                // Use wait property for damage interval (default 0.2s)
                // Original Quake trigger_hurt damages every frame the player is inside
                // but we use wait to prevent excessive damage
                if (game.time < (trigger.data.nextDamage || 0)) return;
                trigger.data.nextDamage = game.time + (trigger.data.wait > 0 ? trigger.data.wait : 0.2);

                // Deal damage to the player
                if (activator.health !== undefined) {
                    activator.health -= trigger.data.damage;
                    console.log(`Trigger hurt: ${trigger.data.damage} damage, health: ${activator.health}`);
                    if (activator.health <= 0 && activator.die) {
                        activator.die(activator, trigger, game);
                    }
                }
                break;

            case 'trigger_push':
                // Set velocity based on trigger angle (push direction)
                // Original Quake: velocity is set every frame while in trigger
                const pushAngle = trigger.data.pushAngle || 0;
                const pushSpeed = trigger.data.pushSpeed;

                if (pushAngle === -1) {
                    // Push up
                    activator.velocity.x = 0;
                    activator.velocity.y = 0;
                    activator.velocity.z = pushSpeed;
                } else if (pushAngle === -2) {
                    // Push down
                    activator.velocity.x = 0;
                    activator.velocity.y = 0;
                    activator.velocity.z = -pushSpeed;
                } else {
                    // Horizontal push based on angle
                    const rad = pushAngle * Math.PI / 180;
                    activator.velocity.x = Math.cos(rad) * pushSpeed;
                    activator.velocity.y = Math.sin(rad) * pushSpeed;
                }

                // Play wind sound with cooldown (not push itself)
                if (activator.classname === 'player') {
                    if (game.time > (activator.data.pushSoundTime || 0)) {
                        activator.data.pushSoundTime = game.time + 1.5;
                        if (game.audio) {
                            game.audio.playLocal('sound/ambience/windfly.wav');
                        }
                    }
                }

                // PUSH_ONCE: Remove trigger after first use
                if (trigger.spawnflags & 1) {
                    game.entities.remove(trigger);
                }
                break;

            case 'trigger_changelevel':
                console.log(`Level change to: ${trigger.data.nextMap}`);
                // Original Quake: set touch to null to prevent re-triggering
                // "we can't move people right now, because touch functions are called
                // in the middle of C movement code, so set a think time to do it"
                trigger.touch = null;

                // Schedule level change for 0.1 seconds later (like original Quake)
                // This prevents issues with calling level change during collision processing
                const nextMap = trigger.data.nextMap;
                const spawner = this;
                trigger.nextThink = game.time + 0.1;
                trigger.think = (self, g, dt) => {
                    // Show intermission with stats before changing level
                    if (g.showIntermission) {
                        g.showIntermission(nextMap);
                    } else {
                        spawner.changeLevel(nextMap, g);
                    }
                    // Clear think to prevent repeat calls
                    self.think = null;
                };
                break;

            case 'trigger_secret':
                if (!trigger.data.found) {
                    trigger.data.found = true;
                    if (game.audio) {
                        game.audio.playLocal('sound/misc/secret.wav');
                    }
                    console.log('You found a secret area!');
                    // Increment secrets found counter
                    if (game.incrementSecrets) {
                        game.incrementSecrets();
                    }
                    // Fire targets/killtargets (original Quake behavior - uses trigger_multiple code)
                    this.fireTargets(trigger, activator, game);
                }
                break;

            case 'trigger_setskill':
                const skillNames = ['Easy', 'Normal', 'Hard', 'Nightmare'];
                game.skill = trigger.data.skill;
                console.log(`Skill set to: ${skillNames[game.skill] || game.skill}`);
                // Fire targets/killtargets (may remove blocking geometry)
                this.fireTargets(trigger, activator, game);
                break;
        }
    }

    fireTargets(source, activator, game) {
        // Fire targets (activate them)
        const targets = game.entities.findTargets(source);

        for (const target of targets) {
            if (target.use) {
                target.use(target, activator, game);
            }
        }

        // Kill targets (remove them)
        if (source.killtarget) {
            this.killTargets(source.killtarget, game);
        }
    }

    /**
     * Remove all entities with matching targetname
     * Original Quake: SUB_UseTargets loops through all entities with matching targetname
     */
    killTargets(targetname, game) {
        if (!targetname) return;

        // Find all entities with this targetname
        const toKill = [];

        // Check all entity categories
        for (const category of ['monsters', 'items', 'triggers', 'funcs']) {
            const entities = game.entities[category] || [];
            for (const entity of entities) {
                if (entity.active && entity.targetname === targetname) {
                    toKill.push(entity);
                }
            }
        }

        // Remove matching entities
        for (const entity of toKill) {
            console.log(`killtarget: removing ${entity.classname} "${entity.targetname}"`);

            // Remove mesh from scene
            if (entity.mesh && game.renderer) {
                game.renderer.removeFromScene(entity.mesh);
            }

            // Remove from physics
            if (game.physics) {
                game.physics.removeEntity(entity);
            }

            // Remove from entity manager
            game.entities.remove(entity);
        }
    }

    async changeLevel(mapName, game) {
        if (!mapName) {
            console.warn('No map name specified for level change');
            return;
        }

        // Check if map exists
        const mapPath = `maps/${mapName}.bsp`;
        if (!game.pak.has(mapPath)) {
            console.warn(`Map not found: ${mapPath}`);
            return;
        }

        console.log(`Changing level to: ${mapName}`);

        // Store player state for transfer
        const playerHealth = game.player.health;
        const playerArmor = game.player.armor;
        const playerArmorType = game.player.armorType;
        const playerWeapons = game.player.weapons;
        const playerItems = game.player.items;
        const playerAmmo = { ...game.player.ammo };
        const playerCurrentWeapon = game.player.currentWeapon;

        // Load new level
        try {
            await game.loadLevel(mapName);

            // Restore player state
            game.player.health = playerHealth;
            game.player.armor = playerArmor;
            game.player.armorType = playerArmorType;
            game.player.weapons = playerWeapons;
            game.player.items = playerItems;
            game.player.ammo = playerAmmo;
            game.player.currentWeapon = playerCurrentWeapon;

            console.log(`Level changed to: ${mapName}`);
        } catch (e) {
            console.error(`Failed to change level to ${mapName}:`, e);
        }
    }

    teleportEntity(entity, destName, game) {
        const dest = game.entities.findByTargetname(destName);
        if (!dest) {
            console.warn(`Teleport destination not found: ${destName}`);
            return;
        }

        console.log(`Teleporting to ${destName} at (${dest.position.x}, ${dest.position.y}, ${dest.position.z})`);

        // Spawn teleport effect at departure point
        if (game.effects) {
            game.effects.teleportSplash(entity.position);
        }

        entity.position = { ...dest.position };

        if (dest.angles) {
            entity.angles.yaw = dest.angles.yaw;
        }

        entity.velocity = { x: 0, y: 0, z: 0 };

        // Spawn teleport effect at arrival point
        if (game.effects) {
            game.effects.teleportSplash(entity.position);
        }

        // Telefrag: kill any entity at the destination
        this.telefrag(entity, game);

        // Play teleport sound
        if (game.audio) {
            game.audio.playLocal('sound/misc/r_tele1.wav');
        }
    }

    /**
     * Telefrag - kill any entity overlapping with the teleported entity
     * Original Quake: T_Damage(other, self, self, 50000) - instant kill
     */
    telefrag(entity, game) {
        const entityHull = entity.hull || { mins: { x: -16, y: -16, z: -24 }, maxs: { x: 16, y: 16, z: 32 } };

        // Check monsters
        const monsters = game.entities.getCategory('monster') || [];
        for (const monster of monsters) {
            if (monster === entity) continue;
            if (!monster.health || monster.health <= 0) continue;

            // Check overlap
            if (this.entitiesOverlap(entity, entityHull, monster)) {
                console.log(`Telefrag: killed ${monster.classname}`);
                // Instant kill
                monster.health = -999;
                if (monster.die) {
                    monster.die(monster, entity, game);
                } else {
                    game.entities.remove(monster);
                }
            }
        }

        // Check player (if entity is a monster teleporting)
        if (entity.classname !== 'player' && game.player) {
            const player = game.player;
            const playerHull = player.hull || { mins: { x: -16, y: -16, z: -24 }, maxs: { x: 16, y: 16, z: 32 } };

            if (this.entitiesOverlap(entity, entityHull, player, playerHull)) {
                console.log('Telefrag: player was telefragged!');
                player.health = -999;
                if (player.die) {
                    player.die(player, entity, game);
                }
            }
        }
    }

    /**
     * Check if two entities overlap (for telefrag)
     */
    entitiesOverlap(ent1, hull1, ent2, hull2) {
        hull2 = hull2 || ent2.hull || { mins: { x: -16, y: -16, z: -24 }, maxs: { x: 16, y: 16, z: 32 } };

        const mins1 = {
            x: ent1.position.x + hull1.mins.x,
            y: ent1.position.y + hull1.mins.y,
            z: ent1.position.z + hull1.mins.z
        };
        const maxs1 = {
            x: ent1.position.x + hull1.maxs.x,
            y: ent1.position.y + hull1.maxs.y,
            z: ent1.position.z + hull1.maxs.z
        };

        const mins2 = {
            x: ent2.position.x + hull2.mins.x,
            y: ent2.position.y + hull2.mins.y,
            z: ent2.position.z + hull2.mins.z
        };
        const maxs2 = {
            x: ent2.position.x + hull2.maxs.x,
            y: ent2.position.y + hull2.maxs.y,
            z: ent2.position.z + hull2.maxs.z
        };

        // Check for overlap on all axes
        return mins1.x < maxs2.x && maxs1.x > mins2.x &&
               mins1.y < maxs2.y && maxs1.y > mins2.y &&
               mins1.z < maxs2.z && maxs1.z > mins2.z;
    }

    spawnFunc(classname, position, entData) {
        const func = this.game.entities.spawn();
        if (!func) return null;

        func.classname = classname;
        func.category = 'func';
        func.position = { ...position };

        func.moveType = 'none';
        func.solid = 'bsp';

        if (entData.model && entData.model.startsWith('*')) {
            func.data.modelIndex = parseInt(entData.model.substring(1));

            // Get bounds from BSP model
            const bspModel = this.bsp.models[func.data.modelIndex];
            if (bspModel) {
                func.hull = {
                    mins: { ...bspModel.mins },
                    maxs: { ...bspModel.maxs }
                };
            }

            // Create and add brush model mesh
            if (this.game.renderer && this.game.renderer.bspRenderer) {
                const mesh = this.game.renderer.bspRenderer.createBrushModelMesh(func.data.modelIndex);
                if (mesh) {
                    func.mesh = mesh;
                    this.game.renderer.addToScene(mesh);
                }
            }
        }

        func.targetname = entData.targetname || '';
        func.target = entData.target || '';
        func.spawnflags = parseInt(entData.spawnflags) || 0;

        // Setup based on type
        switch (classname) {
            case 'func_door':
                this.setupDoor(func, entData);
                break;
            case 'func_button':
                this.setupButton(func, entData);
                break;
            case 'func_plat':
                this.setupPlat(func, entData);
                break;
            case 'func_train':
                this.setupTrain(func, entData);
                break;
            case 'func_rotating':
                this.setupRotating(func, entData);
                break;
            case 'func_illusionary':
                // Visual only, no collision
                func.solid = 'not';
                break;
        }

        // Add to func category for update loop
        this.game.entities.addToCategory(func);

        console.log(`Spawned ${classname} with model *${func.data.modelIndex}, hull:`, func.hull);

        return func;
    }

    setupDoor(door, entData) {
        door.data.lip = parseInt(entData.lip) || 8;
        door.data.speed = parseInt(entData.speed) || 100;
        door.data.wait = parseFloat(entData.wait) || 3;
        door.data.dmg = parseInt(entData.dmg) || 2;
        door.data.state = 'closed';
        door.data.moveProgress = 0;

        // Get brush model bounds to calculate move distance
        const modelIndex = door.data.modelIndex;
        const bspModel = this.bsp.models[modelIndex];
        if (bspModel) {
            // Calculate door size
            const sizeX = bspModel.maxs.x - bspModel.mins.x;
            const sizeY = bspModel.maxs.y - bspModel.mins.y;
            const sizeZ = bspModel.maxs.z - bspModel.mins.z;

            // Determine move direction from angle (or default to largest horizontal axis)
            const angle = entData._angle || 0;
            let moveDir = { x: 0, y: 0, z: 0 };
            let moveDist = 0;

            if (angle === -1) {
                // Up
                moveDir.z = 1;
                moveDist = sizeZ - door.data.lip;
            } else if (angle === -2) {
                // Down
                moveDir.z = -1;
                moveDist = sizeZ - door.data.lip;
            } else {
                // Horizontal movement based on angle
                const rad = angle * Math.PI / 180;
                moveDir.x = Math.cos(rad);
                moveDir.y = Math.sin(rad);

                // Move distance based on which axis we're moving along
                if (Math.abs(moveDir.x) > Math.abs(moveDir.y)) {
                    moveDist = sizeX - door.data.lip;
                } else {
                    moveDist = sizeY - door.data.lip;
                }
            }

            door.data.moveDir = moveDir;
            door.data.moveDist = moveDist;
            door.data.startPos = { ...door.position };
        }

        // Store original mesh position (set by BSPRenderer from model.origin)
        if (door.mesh) {
            door.data.meshStartPos = {
                x: door.mesh.position.x,
                y: door.mesh.position.y,
                z: door.mesh.position.z
            };
        }

        // Spawnflags:
        // 1 = START_OPEN
        // 4 = DON'T_LINK (doors don't link together)
        // 8 = GOLD_KEY
        // 16 = SILVER_KEY
        // 32 = TOGGLE
        const spawnflags = door.spawnflags || 0;
        door.data.needsKey = (spawnflags & 8) || (spawnflags & 16);
        door.data.toggle = (spawnflags & 32) !== 0;

        // START_OPEN: Door starts in open position, "opens" to closed position
        if (spawnflags & 1) {
            // Move meshStartPos to open position BEFORE reversing direction
            if (door.mesh && door.data.meshStartPos) {
                door.data.meshStartPos.x += door.data.moveDir.x * door.data.moveDist;
                door.data.meshStartPos.y += door.data.moveDir.y * door.data.moveDist;
                door.data.meshStartPos.z += door.data.moveDir.z * door.data.moveDist;
            }

            // Swap positions - door starts at what would be "open" position
            // and moves to "closed" position when triggered
            door.data.startPos = {
                x: door.position.x + door.data.moveDir.x * door.data.moveDist,
                y: door.position.y + door.data.moveDir.y * door.data.moveDist,
                z: door.position.z + door.data.moveDir.z * door.data.moveDist
            };

            // Reverse move direction so "opening" goes back to original position
            door.data.moveDir.x *= -1;
            door.data.moveDir.y *= -1;
            door.data.moveDir.z *= -1;

            // Start in "open" state at the open position (moveProgress=0)
            door.data.state = 'open';
            door.data.moveProgress = 0;

            // Update mesh position to open position
            this.updateDoorPosition(door);

            console.log(`START_OPEN door: starts at open position, will close when triggered`);
        }

        door.use = (self, activator, game) => {
            const isStartOpen = (self.spawnflags & 1) !== 0;

            if (self.data.toggle) {
                // Toggle doors switch between open/closed
                if (self.data.state === 'closed') {
                    this.doorOpen(self, game);
                } else if (self.data.state === 'open') {
                    this.doorClose(self, game);
                }
            } else if (isStartOpen) {
                // START_OPEN doors: trigger closes them, then they re-open after wait
                if (self.data.state === 'open') {
                    this.doorClose(self, game);
                }
            } else {
                // Normal doors: trigger opens them
                if (self.data.state === 'closed') {
                    this.doorOpen(self, game);
                }
            }
        };

        door.touch = (self, other, game) => {
            if (!other || other.classname !== 'player') return;

            // Check key requirements (from doors.qc)
            // DOOR_GOLD_KEY (8) requires IT_KEY2 (262144) = gold key
            // DOOR_SILVER_KEY (16) requires IT_KEY1 (131072) = silver key
            const spawnflags = self.spawnflags || 0;
            if (spawnflags & 8) {
                // DOOR_GOLD_KEY - requires gold key (IT_KEY2)
                if (!(other.items & 262144)) { // IT_KEY2
                    if (game.audio) {
                        game.audio.playLocal('sound/misc/runekey.wav');
                    }
                    console.log('You need the gold key');
                    return;
                }
            }
            if (spawnflags & 16) {
                // DOOR_SILVER_KEY - requires silver key (IT_KEY1)
                if (!(other.items & 131072)) { // IT_KEY1
                    if (game.audio) {
                        game.audio.playLocal('sound/misc/medkey.wav');
                    }
                    console.log('You need the silver key');
                    return;
                }
            }

            const isStartOpen = (self.spawnflags & 1) !== 0;

            if (isStartOpen) {
                // START_OPEN doors close when touched
                if (self.data.state === 'open') {
                    this.doorClose(self, game);
                }
            } else {
                // Normal doors open when touched
                if (self.data.state === 'closed') {
                    this.doorOpen(self, game);
                }
            }
        };

        door.think = (self, game, dt) => {
            this.doorThink(self, game, dt);
        };
    }

    doorOpen(door, game) {
        if (door.data.state === 'opening' || door.data.state === 'open') return;

        door.data.state = 'opening';

        if (game.audio) {
            game.audio.playPositioned('sound/doors/doormv1.wav', door.position);
        }
    }

    doorClose(door, game) {
        if (door.data.state === 'closing' || door.data.state === 'closed') return;

        door.data.state = 'closing';

        if (game.audio) {
            game.audio.playPositioned('sound/doors/doormv1.wav', door.position);
        }
    }

    doorThink(door, game, dt) {
        if (!door.data.moveDir) return;

        const speed = door.data.speed * dt;
        const isStartOpen = (door.spawnflags & 1) !== 0;

        if (door.data.state === 'opening') {
            if (isStartOpen) {
                // START_OPEN: opening means moving back toward open position (decrease progress)
                door.data.moveProgress -= speed;
                if (door.data.moveProgress <= 0) {
                    door.data.moveProgress = 0;
                    door.data.state = 'open';
                    // START_OPEN doors don't auto-close after opening
                }
            } else {
                // Normal: opening means moving toward open position (increase progress)
                door.data.moveProgress += speed;
                if (door.data.moveProgress >= door.data.moveDist) {
                    door.data.moveProgress = door.data.moveDist;
                    door.data.state = 'open';
                    door.data.closeTime = game.time + door.data.wait;
                }
            }
            this.updateDoorPosition(door);
        } else if (door.data.state === 'open') {
            // Check if it's time to close (wait = -1 means stay open)
            // Only normal doors auto-close; START_OPEN doors stay open after re-opening
            if (!isStartOpen && door.data.wait >= 0 && game.time >= door.data.closeTime) {
                door.data.state = 'closing';
                if (game.audio) {
                    game.audio.playPositioned('sound/doors/doormv1.wav', door.position);
                }
            }
        } else if (door.data.state === 'closing') {
            if (isStartOpen) {
                // START_OPEN: closing means moving toward closed position (increase progress)
                door.data.moveProgress += speed;
                if (door.data.moveProgress >= door.data.moveDist) {
                    door.data.moveProgress = door.data.moveDist;
                    door.data.state = 'closed';
                    // After closing, schedule re-opening
                    door.data.openTime = game.time + door.data.wait;
                    if (game.audio) {
                        game.audio.playPositioned('sound/doors/drcls4.wav', door.position);
                    }
                }
            } else {
                // Normal: closing means returning to closed position (decrease progress)
                door.data.moveProgress -= speed;
                if (door.data.moveProgress <= 0) {
                    door.data.moveProgress = 0;
                    door.data.state = 'closed';
                    if (game.audio) {
                        game.audio.playPositioned('sound/doors/drcls4.wav', door.position);
                    }
                }
            }
            this.updateDoorPosition(door);
        } else if (door.data.state === 'closed') {
            // START_OPEN doors re-open after wait time
            if (isStartOpen && door.data.wait >= 0 && door.data.openTime && game.time >= door.data.openTime) {
                this.doorOpen(door, game);
            }
        }
    }

    updateDoorPosition(door) {
        const oldPos = { ...door.position };
        const progress = door.data.moveProgress;
        const dir = door.data.moveDir;
        const start = door.data.startPos;

        door.position.x = start.x + dir.x * progress;
        door.position.y = start.y + dir.y * progress;
        door.position.z = start.z + dir.z * progress;

        // Calculate movement delta for pushing entities
        const deltaX = door.position.x - oldPos.x;
        const deltaY = door.position.y - oldPos.y;
        const deltaZ = door.position.z - oldPos.z;

        // Move all entities standing on the door (SV_PushMove)
        this.pushEntitiesOnMover(door, { x: deltaX, y: deltaY, z: deltaZ });

        // Update mesh position (add offset to original mesh position)
        if (door.mesh && door.data.meshStartPos) {
            door.mesh.position.set(
                door.data.meshStartPos.x + dir.x * progress,
                door.data.meshStartPos.y + dir.y * progress,
                door.data.meshStartPos.z + dir.z * progress
            );
        }
        // Note: hull is not updated because Physics.js adds position to hull bounds
        // so collision detection automatically follows the door movement
    }

    setupButton(button, entData) {
        button.data.lip = parseInt(entData.lip) || 4;
        button.data.speed = parseInt(entData.speed) || 40;
        button.data.wait = parseFloat(entData.wait) || 1;
        button.data.health = parseInt(entData.health) || 0;

        // States: 'bottom' (ready), 'up' (moving to pressed), 'top' (waiting), 'down' (returning)
        button.data.state = 'bottom';
        button.data.moveProgress = 0;

        // Calculate move direction from angle (SetMovedir equivalent)
        const angle = entData._angle || 0;
        let moveDir = { x: 0, y: 0, z: 0 };

        if (angle === -1) {
            moveDir = { x: 0, y: 0, z: 1 };  // Up
        } else if (angle === -2) {
            moveDir = { x: 0, y: 0, z: -1 }; // Down
        } else {
            const rad = angle * Math.PI / 180;
            moveDir = { x: Math.cos(rad), y: Math.sin(rad), z: 0 };
        }
        button.data.moveDir = moveDir;

        // Calculate travel distance
        const modelIndex = button.data.modelIndex;
        const bspModel = this.bsp.models[modelIndex];
        if (bspModel) {
            const sizeX = bspModel.maxs.x - bspModel.mins.x;
            const sizeY = bspModel.maxs.y - bspModel.mins.y;
            const sizeZ = bspModel.maxs.z - bspModel.mins.z;

            // Move distance based on direction
            let moveDist;
            if (Math.abs(moveDir.z) > 0) {
                moveDist = sizeZ;
            } else if (Math.abs(moveDir.x) > Math.abs(moveDir.y)) {
                moveDist = sizeX;
            } else {
                moveDist = sizeY;
            }
            button.data.moveDist = moveDist - button.data.lip;
            button.data.startPos = { ...button.position };
        }

        // Store original mesh position
        if (button.mesh && !button.data.meshStartPos) {
            button.data.meshStartPos = {
                x: button.mesh.position.x,
                y: button.mesh.position.y,
                z: button.mesh.position.z
            };
        }

        // Touch activation (only if health = 0)
        if (button.data.health === 0) {
            button.touch = (self, other, game) => {
                if (other.classname !== 'player') return;
                if (self.data.state === 'bottom') {
                    this.buttonFire(self, other, game);
                }
            };
        }

        // Use activation (when triggered by another entity or use key)
        button.use = (self, activator, game) => {
            if (self.data.state === 'bottom') {
                this.buttonFire(self, activator, game);
            }
        };

        button.think = (self, game, dt) => {
            this.buttonThink(self, game, dt);
        };
    }

    buttonFire(button, activator, game) {
        if (button.data.state !== 'bottom') return;

        button.data.state = 'up';  // Moving to pressed position
        button.data.activator = activator;

        // Switch to alternate texture sequence (frame 1)
        // Original Quake: QuakeC sets self.frame = 1 in button_fire
        button.frame = 1;
        if (button.mesh && game.renderer && game.renderer.bspRenderer) {
            game.renderer.bspRenderer.setBrushModelFrame(button.mesh, 1);
        }

        if (game.audio) {
            game.audio.playPositioned('sound/buttons/switch21.wav', button.position);
        }
    }

    buttonThink(button, game, dt) {
        if (!button.data.moveDist) return;

        const speed = button.data.speed * dt;

        if (button.data.state === 'up') {
            // Moving to pressed position
            button.data.moveProgress += speed;
            if (button.data.moveProgress >= button.data.moveDist) {
                button.data.moveProgress = button.data.moveDist;
                button.data.state = 'top';
                button.data.returnTime = game.time + button.data.wait;

                // Fire targets when reaching pressed position
                this.fireTargets(button, button.data.activator, game);
            }
            this.updateButtonPosition(button);
        } else if (button.data.state === 'top') {
            // Waiting at pressed position
            if (button.data.wait >= 0 && game.time >= button.data.returnTime) {
                button.data.state = 'down';  // Start returning
            }
        } else if (button.data.state === 'down') {
            // Returning to unpressed position
            button.data.moveProgress -= speed;
            if (button.data.moveProgress <= 0) {
                button.data.moveProgress = 0;
                button.data.state = 'bottom';  // Ready for next press

                // Switch back to primary texture sequence (frame 0)
                // Original Quake: QuakeC sets self.frame = 0 in button_return
                button.frame = 0;
                if (button.mesh && this.game.renderer && this.game.renderer.bspRenderer) {
                    this.game.renderer.bspRenderer.setBrushModelFrame(button.mesh, 0);
                }
            }
            this.updateButtonPosition(button);
        }
    }

    updateButtonPosition(button) {
        const progress = button.data.moveProgress;
        const dir = button.data.moveDir;
        const start = button.data.startPos;

        if (!start || !dir) return;

        button.position.x = start.x + dir.x * progress;
        button.position.y = start.y + dir.y * progress;
        button.position.z = start.z + dir.z * progress;

        // Update mesh position
        if (button.mesh && button.data.meshStartPos) {
            button.mesh.position.set(
                button.data.meshStartPos.x + dir.x * progress,
                button.data.meshStartPos.y + dir.y * progress,
                button.data.meshStartPos.z + dir.z * progress
            );
        }
        // Note: hull is not updated because Physics.js adds position to hull bounds
    }

    setupPlat(plat, entData) {
        plat.data.speed = parseInt(entData.speed) || 150;
        // Platforms have hardcoded 3-second wait at top in original Quake
        plat.data.wait = 3;
        plat.data.moveProgress = 0;

        // Calculate platform height from BSP model or explicit height
        const modelIndex = plat.data.modelIndex;
        const bspModel = this.bsp.models[modelIndex];
        if (bspModel) {
            const sizeZ = bspModel.maxs.z - bspModel.mins.z;
            // Default height is platform thickness - 8 (leaves 8 units visible at bottom)
            plat.data.height = parseInt(entData.height) || (sizeZ - 8);
            plat.data.startPos = { ...plat.position };
        }

        // Store original mesh position
        if (plat.mesh) {
            plat.data.meshStartPos = {
                x: plat.mesh.position.x,
                y: plat.mesh.position.y,
                z: plat.mesh.position.z
            };
        }

        plat.think = (self, game, dt) => {
            this.platThink(self, game, dt);
        };

        // Check if platform is trigger-activated (has targetname)
        if (plat.targetname) {
            // Triggered platform: starts at TOP (pos1), goes down when triggered
            plat.data.moveProgress = 0;
            plat.data.state = STATE_TOP;
            plat.data.triggered = false;

            // Ensure mesh position matches initial state (at top)
            this.updatePlatPosition(plat);

            // Touch behavior for triggered platforms (only after first trigger)
            plat.touch = (self, other, game) => {
                if (other.classname !== 'player') return;
                if (other.health <= 0) return;
                if (!self.data.triggered) return;  // Wait for button press first

                if (self.data.state === STATE_BOTTOM) {
                    // At bottom, go up when touched
                    this.platGoUp(self, game);
                } else if (self.data.state === STATE_TOP) {
                    // At top, delay descent by 1 second
                    self.data.returnTime = game.time + 1;
                }
            };

            // Use callback to handle trigger activation (button press)
            plat.use = (self, activator, game) => {
                if (self.data.state === STATE_TOP && !self.data.triggered) {
                    self.data.triggered = true;
                    this.platGoDown(self, game);
                }
            };

            console.log(`Triggered platform ${plat.targetname}: starts at TOP, waiting for trigger`);
        } else {
            // Regular platform: starts at BOTTOM (pos2), raises when touched
            plat.data.moveProgress = plat.data.height;
            plat.data.state = STATE_BOTTOM;
            this.updatePlatPosition(plat);

            plat.touch = (self, other, game) => {
                if (other.classname !== 'player') return;
                if (other.health <= 0) return;

                if (self.data.state === STATE_BOTTOM) {
                    // At bottom, go up when touched
                    this.platGoUp(self, game);
                } else if (self.data.state === STATE_TOP) {
                    // At top, delay descent by 1 second
                    self.data.returnTime = game.time + 1;
                }
            };

            console.log(`Regular platform: starts at BOTTOM (moveProgress=${plat.data.height})`);
        }
    }

    platGoUp(plat, game) {
        if (plat.data.state === STATE_UP || plat.data.state === STATE_TOP) return;
        plat.data.state = STATE_UP;
        if (game.audio) {
            game.audio.playPositioned('sound/plats/train2.wav', plat.position);
        }
    }

    platGoDown(plat, game) {
        if (plat.data.state === STATE_DOWN || plat.data.state === STATE_BOTTOM) return;
        plat.data.state = STATE_DOWN;
        if (game.audio) {
            game.audio.playPositioned('sound/plats/train2.wav', plat.position);
        }
    }

    platThink(plat, game, dt) {
        if (!plat.data.height) return;

        const speed = plat.data.speed * dt;

        if (plat.data.state === STATE_UP) {
            plat.data.moveProgress -= speed;
            if (plat.data.moveProgress <= 0) {
                plat.data.moveProgress = 0;
                plat.data.state = STATE_TOP;
                plat.data.returnTime = game.time + plat.data.wait;
            }
            this.updatePlatPosition(plat);
        } else if (plat.data.state === STATE_TOP) {
            // Wait then lower (only if returnTime has been set)
            if (plat.data.returnTime && plat.data.wait >= 0 && game.time >= plat.data.returnTime) {
                this.platGoDown(plat, game);
            }
        } else if (plat.data.state === STATE_DOWN) {
            plat.data.moveProgress += speed;
            if (plat.data.moveProgress >= plat.data.height) {
                plat.data.moveProgress = plat.data.height;
                plat.data.state = STATE_BOTTOM;
            }
            this.updatePlatPosition(plat);
        }
    }

    updatePlatPosition(plat) {
        const oldZ = plat.position.z;
        const progress = plat.data.moveProgress;
        const start = plat.data.startPos || { x: 0, y: 0, z: 0 };

        // Platform moves down (negative Z)
        plat.position.x = start.x;
        plat.position.y = start.y;
        plat.position.z = start.z - progress;

        const deltaZ = plat.position.z - oldZ;

        // Move all entities standing on the platform (SV_PushMove)
        this.pushEntitiesOnMover(plat, { x: 0, y: 0, z: deltaZ });

        // Update mesh position
        if (plat.mesh && plat.data.meshStartPos) {
            plat.mesh.position.set(
                plat.data.meshStartPos.x,
                plat.data.meshStartPos.y,
                plat.data.meshStartPos.z - progress
            );
        }
        // Note: hull is not updated because Physics.js adds position to hull bounds
    }

    /**
     * Push all entities standing on a mover (SV_PushMove from sv_phys.c)
     * Original Quake iterates ALL entities and pushes any that are standing
     * on the pusher or overlapping its bounding box.
     * @param {Object} mover - The moving brush entity (door/plat/train)
     * @param {Object} delta - Movement delta {x, y, z}
     */
    pushEntitiesOnMover(mover, delta) {
        if (delta.x === 0 && delta.y === 0 && delta.z === 0) return;

        // Collect all pushable entities: player, monsters, items
        const entities = [];

        if (this.game.player) {
            entities.push(this.game.player);
        }

        const monsters = this.game.entities.getCategory('monster') || [];
        for (const m of monsters) {
            if (m.active && m.position) entities.push(m);
        }

        const items = this.game.entities.getCategory('item') || [];
        for (const item of items) {
            if (item.active && item.position) entities.push(item);
        }

        for (const ent of entities) {
            const onGroundEntity = ent.onGround && ent.groundEntity === mover;
            const onMoverPosition = this.isEntityOnPlatform(ent, mover);

            if (onGroundEntity || onMoverPosition) {
                ent.position.x += delta.x;
                ent.position.y += delta.y;
                ent.position.z += delta.z;

                // Update mesh position for monsters/items
                if (ent.mesh && ent.classname !== 'player') {
                    ent.mesh.position.set(ent.position.x, ent.position.y, ent.position.z);
                }

                if (onMoverPosition && !onGroundEntity) {
                    ent.groundEntity = mover;
                }
            }
        }
    }

    isEntityOnPlatform(entity, plat) {
        if (!plat.hull) return false;

        const entityHull = entity.hull || { mins: { x: -16, y: -16, z: -24 }, maxs: { x: 16, y: 16, z: 32 } };

        // Platform uses position + hull bounds (matching Physics.js convention)
        const platTop = plat.position.z + plat.hull.maxs.z;
        const platMins = {
            x: plat.position.x + plat.hull.mins.x,
            y: plat.position.y + plat.hull.mins.y
        };
        const platMaxs = {
            x: plat.position.x + plat.hull.maxs.x,
            y: plat.position.y + plat.hull.maxs.y
        };

        // Entity uses position + hull (player hull is relative to position)
        const entityFeet = entity.position.z + entityHull.mins.z;
        const entityMins = {
            x: entity.position.x + entityHull.mins.x,
            y: entity.position.y + entityHull.mins.y
        };
        const entityMaxs = {
            x: entity.position.x + entityHull.maxs.x,
            y: entity.position.y + entityHull.maxs.y
        };

        // Check if entity is standing on platform (within 2 units above it)
        // Original Quake uses trace, so tolerance should be minimal
        const onTop = entityFeet >= platTop - 1 && entityFeet <= platTop + 2;

        // Check horizontal overlap
        const overlapsX = entityMins.x < platMaxs.x && entityMaxs.x > platMins.x;
        const overlapsY = entityMins.y < platMaxs.y && entityMaxs.y > platMins.y;

        return onTop && overlapsX && overlapsY;
    }

    setupTrain(train, entData) {
        train.data.speed = parseInt(entData.speed) || 100;
        train.data.dmg = parseInt(entData.dmg) || 0;
        train.data.target = entData.target || '';
        train.data.currentCorner = null;
        train.data.nextCorner = null;
        train.data.moveProgress = 0;
        train.data.moveDist = 0;
        train.data.state = 'stopped';  // 'stopped', 'moving', 'waiting'
        train.data.waitTime = 0;

        // Store original mesh position
        if (train.mesh) {
            train.data.meshStartPos = {
                x: train.mesh.position.x,
                y: train.mesh.position.y,
                z: train.mesh.position.z
            };
        }

        // Trains start when triggered
        train.use = (self, activator, game) => {
            if (self.data.state === 'stopped') {
                this.trainStart(self, game);
            }
        };

        train.think = (self, game, dt) => {
            this.trainThink(self, game, dt);
        };

        console.log(`Spawned func_train with target: ${train.data.target}`);
    }

    trainStart(train, game) {
        // Find the first path_corner
        if (!train.data.target || !game.pathCorners) return;

        const firstCorner = game.pathCorners.find(pc => pc.targetname === train.data.target);
        if (!firstCorner) {
            console.warn(`Train target path_corner not found: ${train.data.target}`);
            return;
        }

        // Move train to first corner instantly (original Quake behavior)
        const bspModel = this.bsp.models[train.data.modelIndex];
        if (bspModel) {
            // Calculate center of train model
            const centerX = (bspModel.mins.x + bspModel.maxs.x) / 2;
            const centerY = (bspModel.mins.y + bspModel.maxs.y) / 2;
            const centerZ = bspModel.mins.z;  // Bottom of train

            // Position train so its center is at the path_corner
            train.position.x = firstCorner.position.x - centerX;
            train.position.y = firstCorner.position.y - centerY;
            train.position.z = firstCorner.position.z - centerZ;

            // Update mesh
            if (train.mesh) {
                train.mesh.position.set(train.position.x, train.position.y, train.position.z);
            }
        }

        train.data.currentCorner = firstCorner;

        // Find next corner and start moving
        this.trainNext(train, game);

        if (game.audio) {
            game.audio.playPositioned('sound/plats/train1.wav', train.position);
        }
    }

    trainNext(train, game) {
        if (!train.data.currentCorner || !train.data.currentCorner.target) {
            train.data.state = 'stopped';
            return;
        }

        // Find next corner
        const nextCorner = game.pathCorners.find(pc => pc.targetname === train.data.currentCorner.target);
        if (!nextCorner) {
            train.data.state = 'stopped';
            return;
        }

        train.data.nextCorner = nextCorner;

        // Calculate movement
        const bspModel = this.bsp.models[train.data.modelIndex];
        const centerX = bspModel ? (bspModel.mins.x + bspModel.maxs.x) / 2 : 0;
        const centerY = bspModel ? (bspModel.mins.y + bspModel.maxs.y) / 2 : 0;
        const centerZ = bspModel ? bspModel.mins.z : 0;

        const targetPos = {
            x: nextCorner.position.x - centerX,
            y: nextCorner.position.y - centerY,
            z: nextCorner.position.z - centerZ
        };

        train.data.startPos = { ...train.position };
        train.data.endPos = targetPos;

        const dx = targetPos.x - train.position.x;
        const dy = targetPos.y - train.position.y;
        const dz = targetPos.z - train.position.z;
        train.data.moveDist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        train.data.moveProgress = 0;
        train.data.state = 'moving';
    }

    trainThink(train, game, dt) {
        if (train.data.state === 'waiting') {
            if (game.time >= train.data.waitTime) {
                this.trainNext(train, game);
            }
            return;
        }

        if (train.data.state !== 'moving') return;
        if (train.data.moveDist <= 0) return;

        const oldPos = { ...train.position };
        const speed = train.data.speed * dt;

        train.data.moveProgress += speed;

        if (train.data.moveProgress >= train.data.moveDist) {
            // Reached destination
            train.position = { ...train.data.endPos };
            train.data.currentCorner = train.data.nextCorner;

            // Check for wait time at this corner
            if (train.data.currentCorner.wait > 0) {
                train.data.state = 'waiting';
                train.data.waitTime = game.time + train.data.currentCorner.wait;
            } else {
                // Continue immediately to next corner
                this.trainNext(train, game);
            }
        } else {
            // Interpolate position
            const t = train.data.moveProgress / train.data.moveDist;
            train.position.x = train.data.startPos.x + (train.data.endPos.x - train.data.startPos.x) * t;
            train.position.y = train.data.startPos.y + (train.data.endPos.y - train.data.startPos.y) * t;
            train.position.z = train.data.startPos.z + (train.data.endPos.z - train.data.startPos.z) * t;
        }

        // Calculate movement delta
        const deltaX = train.position.x - oldPos.x;
        const deltaY = train.position.y - oldPos.y;
        const deltaZ = train.position.z - oldPos.z;

        // Update mesh position
        if (train.mesh) {
            train.mesh.position.set(train.position.x, train.position.y, train.position.z);
        }

        // Move all entities standing on train (SV_PushMove)
        this.pushEntitiesOnMover(train, { x: deltaX, y: deltaY, z: deltaZ });
    }

    setupRotating(rotating, entData) {
        // func_rotating - continuously spinning brush entity
        // speed = rotation speed in degrees per second (default 100)
        // Spawnflags:
        //   1 = X_AXIS (rotate around X instead of Z)
        //   2 = Y_AXIS (rotate around Y instead of Z)
        rotating.data.speed = parseFloat(entData.speed) || 100;
        rotating.data.currentAngle = 0;

        // Determine rotation axis from spawnflags
        const spawnflags = rotating.spawnflags || 0;
        if (spawnflags & 1) {
            rotating.data.axis = 'x';
        } else if (spawnflags & 2) {
            rotating.data.axis = 'y';
        } else {
            rotating.data.axis = 'z'; // Default Z axis
        }

        // Store original mesh position for rotation center
        if (rotating.mesh) {
            rotating.data.meshCenter = {
                x: rotating.mesh.position.x,
                y: rotating.mesh.position.y,
                z: rotating.mesh.position.z
            };
        }

        // Can be toggled on/off with use
        rotating.data.active = true;

        rotating.use = (self, activator, game) => {
            self.data.active = !self.data.active;
        };

        rotating.think = (self, game, dt) => {
            if (!self.data.active) return;
            if (!self.mesh) return;

            // Update rotation angle
            self.data.currentAngle += self.data.speed * dt;
            if (self.data.currentAngle >= 360) {
                self.data.currentAngle -= 360;
            } else if (self.data.currentAngle < 0) {
                self.data.currentAngle += 360;
            }

            const radians = self.data.currentAngle * Math.PI / 180;

            // Apply rotation based on axis
            switch (self.data.axis) {
                case 'x':
                    self.mesh.rotation.x = radians;
                    break;
                case 'y':
                    self.mesh.rotation.y = radians;
                    break;
                case 'z':
                default:
                    self.mesh.rotation.z = radians;
                    break;
            }
        };

        console.log(`Spawned func_rotating: speed=${rotating.data.speed}, axis=${rotating.data.axis}`);
    }

    spawnTeleportDest(entData) {
        const dest = this.game.entities.spawn();
        if (!dest) return null;

        dest.classname = 'info_teleport_destination';
        dest.position = entData._origin || { x: 0, y: 0, z: 0 };
        dest.position.z += 27; // Original Quake: self.origin = self.origin + '0 0 27'
        dest.angles = { pitch: 0, yaw: entData._angle || 0, roll: 0 };
        dest.targetname = entData.targetname || '';

        console.log(`Spawned teleport destination: ${dest.targetname} at (${dest.position.x}, ${dest.position.y}, ${dest.position.z})`);

        return dest;
    }

    async spawnLight(classname, position, entData) {
        // Lights are baked into lightmaps, but we track them for dynamic effects
        const light = {
            classname,
            position: { ...position },
            light: parseInt(entData.light) || 300,
            style: parseInt(entData.style) || 0,
            targetname: entData.targetname || ''
        };

        // Store for potential dynamic effects
        if (!this.game.lights) this.game.lights = [];
        this.game.lights.push(light);

        // Spawn flame model for torch entities
        if (classname === 'light_flame_large_yellow' ||
            classname === 'light_flame_small_yellow' ||
            classname === 'light_torch_small_walltorch') {

            const flameModel = classname === 'light_flame_large_yellow'
                ? 'progs/flame2.mdl'
                : 'progs/flame.mdl';

            try {
                await this.spawnFlame(position, flameModel, light);
            } catch (e) {
                console.warn(`Failed to spawn flame at ${position.x}, ${position.y}, ${position.z}:`, e);
            }
        }

        return light;
    }

    async spawnFlame(position, modelName, light) {
        if (!this.game.renderer || !this.game.renderer.aliasRenderer) return;

        try {
            const modelData = await this.game.renderer.aliasRenderer.loadModel(modelName);
            if (!modelData) return;

            const mesh = this.game.renderer.aliasRenderer.createInstance(modelData);
            if (!mesh) return;

            // Position the flame
            mesh.position.set(position.x, position.y, position.z);

            // Disable frustum culling so flames always render
            mesh.frustumCulled = false;

            // Add to light styles system for frame animation
            // Original Quake: flames are fullbright models, no dynamic lighting
            const flameData = {
                mesh,
                modelData,
                light,
                time: Math.random() * 10
            };

            if (this.game.renderer.lightStyles) {
                this.game.renderer.lightStyles.addFlame(flameData);
            }

            this.game.renderer.addToScene(mesh);
        } catch (e) {
            // Flame model not found, skip silently
        }
    }

    spawnAmbient(classname, position, entData) {
        // Ambient sounds
        const sounds = {
            'ambient_suck_wind': 'ambience/suck1.wav',
            'ambient_drone': 'ambience/drone6.wav',
            'ambient_drip': 'ambience/drip1.wav',
            'ambient_comp_hum': 'ambience/comp1.wav',
            'ambient_swamp1': 'ambience/swamp1.wav',
            'ambient_swamp2': 'ambience/swamp2.wav'
        };

        const soundPath = sounds[classname];
        if (soundPath) {
            // game.audio.playAmbient(soundPath, position);
        }

        return { classname, position, sound: soundPath };
    }

    spawnPathCorner(entData) {
        const corner = {
            classname: 'path_corner',
            position: entData._origin || { x: 0, y: 0, z: 0 },
            targetname: entData.targetname || '',
            target: entData.target || '',
            wait: parseFloat(entData.wait) || 0
        };

        // Store for train/monster pathing
        if (!this.game.pathCorners) this.game.pathCorners = [];
        this.game.pathCorners.push(corner);

        return corner;
    }

    spawnExploBox(position, entData) {
        const box = this.game.entities.spawn();
        if (!box) return null;

        box.classname = 'misc_explobox';
        box.position = { ...position };
        box.moveType = 'none';
        box.solid = 'bbox';
        box.hull = {
            mins: { x: -16, y: -16, z: 0 },
            maxs: { x: 16, y: 16, z: 64 }
        };

        box.health = 20;

        // When destroyed, explode
        box.die = (self, attacker, game) => {
            // Explosion damage and effect
            // game.effects.explosion(self.position);
            game.entities.remove(self);
        };

        return box;
    }
}
