import { IT, WEAPON, playerGiveWeapon, playerGiveAmmo, playerGiveHealth, playerGiveArmor } from '../entities/Player.js';

/**
 * Items - Item definitions and pickup behavior
 */

export const ITEM_TYPES = {
    // Health
    'item_health': {
        model: 'maps/b_bh25.bsp',
        sound: 'items/health1.wav',
        amount: 25,
        respawnTime: 20,
        pickup: (player, item) => playerGiveHealth(player, 25)
    },
    'item_health_large': {
        model: 'maps/b_bh100.bsp',
        sound: 'items/r_item2.wav',
        amount: 100,
        respawnTime: 0,  // Megahealth doesn't respawn on timer — respawns when health rot finishes
        pickup: (player, item) => {
            const result = playerGiveHealth(player, 100, 250);
            if (result) {
                player.items |= IT.SUPERHEALTH;
                // Link item to player for respawn when rot finishes (original Quake behavior)
                player.megahealthItem = item;
            }
            return result;
        }
    },

    // Armor
    'item_armor1': {
        model: 'progs/armor.mdl',
        skin: 0,
        sound: 'items/armor1.wav',
        respawnTime: 20,
        pickup: (player) => playerGiveArmor(player, 100, 0.3)
    },
    'item_armor2': {
        model: 'progs/armor.mdl',
        skin: 1,
        sound: 'items/armor1.wav',
        respawnTime: 20,
        pickup: (player) => playerGiveArmor(player, 150, 0.6)
    },
    'item_armorInv': {
        model: 'progs/armor.mdl',
        skin: 2,
        sound: 'items/armor1.wav',
        respawnTime: 20,
        pickup: (player) => playerGiveArmor(player, 200, 0.8)
    },

    // Ammo - Small boxes
    'item_shells': {
        model: 'maps/b_shell0.bsp',
        sound: 'weapons/lock4.wav',
        respawnTime: 30,
        pickup: (player) => {
            playerGiveAmmo(player, 'shells', 20);
            return true;
        }
    },
    'item_spikes': {
        model: 'maps/b_nail0.bsp',
        sound: 'weapons/lock4.wav',
        respawnTime: 30,
        pickup: (player) => {
            playerGiveAmmo(player, 'nails', 25);
            return true;
        }
    },
    'item_rockets': {
        model: 'maps/b_rock0.bsp',
        sound: 'weapons/lock4.wav',
        respawnTime: 30,
        pickup: (player) => {
            playerGiveAmmo(player, 'rockets', 5);
            return true;
        }
    },
    'item_cells': {
        model: 'maps/b_batt0.bsp',
        sound: 'weapons/lock4.wav',
        respawnTime: 30,
        pickup: (player) => {
            playerGiveAmmo(player, 'cells', 6);
            return true;
        }
    },

    // Ammo - Large boxes (original Quake items.qc: weapon_*big)
    'item_shells_large': {
        model: 'maps/b_shell1.bsp',
        sound: 'weapons/lock4.wav',
        respawnTime: 30,
        pickup: (player) => {
            playerGiveAmmo(player, 'shells', 40);
            return true;
        }
    },
    'item_spikes_large': {
        model: 'maps/b_nail1.bsp',
        sound: 'weapons/lock4.wav',
        respawnTime: 30,
        pickup: (player) => {
            playerGiveAmmo(player, 'nails', 50);
            return true;
        }
    },
    'item_rockets_large': {
        model: 'maps/b_rock1.bsp',
        sound: 'weapons/lock4.wav',
        respawnTime: 30,
        pickup: (player) => {
            playerGiveAmmo(player, 'rockets', 10);
            return true;
        }
    },
    'item_cells_large': {
        model: 'maps/b_batt1.bsp',
        sound: 'weapons/lock4.wav',
        respawnTime: 30,
        pickup: (player) => {
            playerGiveAmmo(player, 'cells', 12);
            return true;
        }
    },

    // Weapons
    'weapon_supershotgun': {
        model: 'progs/g_shot.mdl',
        sound: 'weapons/pkup.wav',
        respawnTime: 30,
        pickup: (player) => {
            playerGiveWeapon(player, IT.SUPER_SHOTGUN);
            playerGiveAmmo(player, 'shells', 5);
            return true;
        }
    },
    'weapon_nailgun': {
        model: 'progs/g_nail.mdl',
        sound: 'weapons/pkup.wav',
        respawnTime: 30,
        pickup: (player) => {
            playerGiveWeapon(player, IT.NAILGUN);
            playerGiveAmmo(player, 'nails', 30);
            return true;
        }
    },
    'weapon_supernailgun': {
        model: 'progs/g_nail2.mdl',
        sound: 'weapons/pkup.wav',
        respawnTime: 30,
        pickup: (player) => {
            playerGiveWeapon(player, IT.SUPER_NAILGUN);
            playerGiveAmmo(player, 'nails', 30);
            return true;
        }
    },
    'weapon_grenadelauncher': {
        model: 'progs/g_rock.mdl',
        sound: 'weapons/pkup.wav',
        respawnTime: 30,
        pickup: (player) => {
            playerGiveWeapon(player, IT.GRENADE_LAUNCHER);
            playerGiveAmmo(player, 'rockets', 5);
            return true;
        }
    },
    'weapon_rocketlauncher': {
        model: 'progs/g_rock2.mdl',
        sound: 'weapons/pkup.wav',
        respawnTime: 30,
        pickup: (player) => {
            playerGiveWeapon(player, IT.ROCKET_LAUNCHER);
            playerGiveAmmo(player, 'rockets', 5);
            return true;
        }
    },
    'weapon_lightning': {
        model: 'progs/g_light.mdl',
        sound: 'weapons/pkup.wav',
        respawnTime: 30,
        pickup: (player) => {
            playerGiveWeapon(player, IT.LIGHTNING);
            playerGiveAmmo(player, 'cells', 15);
            return true;
        }
    },

    // Power-ups
    'item_artifact_invulnerability': {
        model: 'progs/invulner.mdl',
        sound: 'items/protect.wav',
        respawnTime: 300,
        pickup: (player, item, game) => {
            player.items |= IT.INVULNERABILITY;
            player.invincibleTime = 30;
            return true;
        }
    },
    'item_artifact_invisibility': {
        model: 'progs/invisibl.mdl',
        sound: 'items/inv1.wav',
        respawnTime: 300,
        pickup: (player, item, game) => {
            player.items |= IT.INVISIBILITY;
            player.invisibleTime = 30;
            return true;
        }
    },
    'item_artifact_super_damage': {
        model: 'progs/quaddama.mdl',
        sound: 'items/damage.wav',
        respawnTime: 60,
        pickup: (player, item, game) => {
            player.items |= IT.QUAD;
            player.quadTime = 30;
            return true;
        }
    },
    'item_artifact_envirosuit': {
        model: 'progs/suit.mdl',
        sound: 'items/suit.wav',
        respawnTime: 60,
        pickup: (player, item, game) => {
            player.items |= IT.SUIT;
            player.suitTime = 30;
            return true;
        }
    },

    // Keys (from items.qc key_touch)
    // Original: if (other.items & self.items) return; // Already has this key
    'item_key1': {
        model: 'progs/w_s_key.mdl',
        sound: 'misc/medkey.wav',
        respawnTime: 0, // Keys don't respawn
        pickup: (player) => {
            if (player.items & IT.KEY1) return false; // Already has silver key
            player.items |= IT.KEY1;
            return true;
        }
    },
    'item_key2': {
        model: 'progs/w_g_key.mdl',
        sound: 'misc/runekey.wav',
        respawnTime: 0,
        pickup: (player) => {
            if (player.items & IT.KEY2) return false; // Already has gold key
            player.items |= IT.KEY2;
            return true;
        }
    }
};

export async function createItem(entityManager, classname, position, game) {
    const itemDef = ITEM_TYPES[classname];
    if (!itemDef) {
        console.warn(`Unknown item type: ${classname}`);
        return null;
    }

    const item = entityManager.spawn();
    if (!item) return null;

    item.classname = classname;
    item.category = 'item';
    item.position = { ...position };

    item.moveType = 'none';
    item.solid = 'trigger';
    item.hull = {
        mins: { x: -16, y: -16, z: -24 },
        maxs: { x: 16, y: 16, z: 32 }
    };

    item.data.itemDef = itemDef;
    item.data.respawnTime = 0;
    item.data.rotationAngle = 0;

    item.touch = itemTouch;

    // Load item model
    if (itemDef.model && game.renderer) {
        try {
            if (itemDef.model.endsWith('.mdl')) {
                // Load MDL model (armor, weapons)
                const modelData = await game.renderer.loadModel(itemDef.model, game.pak);
                if (modelData) {
                    const mesh = game.renderer.createModelInstance(modelData);
                    if (mesh) {
                        item.mesh = mesh;
                        mesh.position.set(position.x, position.y, position.z);

                        // Set skin if specified (for armor types)
                        if (itemDef.skin !== undefined && mesh.material && mesh.material.map) {
                            // TODO: Implement skin switching
                        }

                        game.renderer.addToScene(mesh);
                    }
                }
            } else if (itemDef.model.endsWith('.bsp')) {
                // Load BSP model (ammo boxes, health)
                const mesh = await loadItemBSPModel(itemDef.model, game);
                if (mesh) {
                    item.mesh = mesh;
                    mesh.position.set(position.x, position.y, position.z);
                    game.renderer.addToScene(mesh);
                }
            }
        } catch (e) {
            console.warn(`Failed to load item model ${itemDef.model}:`, e);
        }
    }

    entityManager.addToCategory(item);

    // Drop item to floor (like original Quake's droptofloor)
    // This traces downward and places the item on the ground
    if (game.physics) {
        dropToFloor(item, game);
    }

    return item;
}

/**
 * Drop an item to the floor (SUB_DropToFloor from original Quake items.qc)
 * Traces downward from spawn position to find the floor
 */
function dropToFloor(item, game) {
    const start = { ...item.position };
    const end = {
        x: item.position.x,
        y: item.position.y,
        z: item.position.z - 256  // Trace 256 units down
    };

    const trace = game.physics.traceLine(start, end, item.hull);

    if (trace.fraction < 1.0 && trace.endpos) {
        // Found floor - move item there
        item.position.x = trace.endpos.x;
        item.position.y = trace.endpos.y;
        item.position.z = trace.endpos.z;

        // Update mesh position
        if (item.mesh) {
            item.mesh.position.set(
                item.position.x,
                item.position.y,
                item.position.z
            );
        }

        // Store base Z for bobbing animation
        item.data.baseZ = item.position.z;
    }
}

async function loadItemBSPModel(modelPath, game) {
    if (!game.pak || !game.renderer) return null;

    try {
        const bspData = game.pak.get(modelPath);
        if (!bspData) return null;

        // Import BSPLoader dynamically to avoid circular deps
        const { BSPLoader } = await import('../loaders/BSPLoader.js');
        const bsp = new BSPLoader();
        bsp.load(bspData);

        // Create mesh from BSP model 0 (the item model)
        if (game.renderer.bspRenderer) {
            const mesh = game.renderer.bspRenderer.createBrushModelMesh(0, bsp);
            return mesh;
        }
    } catch (e) {
        console.warn(`Failed to load BSP model ${modelPath}:`, e);
    }

    return null;
}

function itemTouch(item, other, game) {
    // Only players can pick up items
    if (other.classname !== 'player') return;

    // Check respawn timer
    if (item.data.respawnTime > game.time) return;

    const itemDef = item.data.itemDef;

    // Try to pick up
    const pickedUp = itemDef.pickup(other, item, game);

    if (pickedUp) {
        // Play pickup sound
        if (itemDef.sound && game.audio) {
            game.audio.playLocal(`sound/${itemDef.sound}`);
        }

        // Bonus flash
        other.bonusTime = 0.4;

        // Set respawn timer or remove
        if (itemDef.respawnTime > 0) {
            item.data.respawnTime = game.time + itemDef.respawnTime;
            // Hide item temporarily
            if (item.mesh) {
                item.mesh.visible = false;
            }
        } else {
            game.entities.remove(item);
        }
    }
}

export function updateItems(game, deltaTime) {
    // Check for respawning items and animate
    for (const item of game.entities.items) {
        if (!item.active) continue;

        // Handle respawning
        if (item.data.respawnTime > 0 && game.time >= item.data.respawnTime) {
            item.data.respawnTime = 0;
            if (item.mesh) {
                item.mesh.visible = true;
            }
            // Play respawn sound
            if (game.audio) {
                game.audio.playPositioned('sound/items/itembk2.wav', item.position);
            }
        }

        // Rotate and bob items (like in original Quake)
        if (item.mesh && item.mesh.visible) {
            // Rotation - items spin around Z axis
            item.data.rotationAngle += deltaTime * 100; // ~100 degrees per second
            if (item.data.rotationAngle >= 360) {
                item.data.rotationAngle -= 360;
            }
            item.mesh.rotation.z = (item.data.rotationAngle * Math.PI) / 180;

            // Bobbing - items float up and down
            // Initialize bob time if needed
            if (item.data.bobTime === undefined) {
                item.data.bobTime = Math.random() * Math.PI * 2; // Random start phase
                item.data.baseZ = item.position.z; // Store original Z position
            }
            item.data.bobTime += deltaTime * 4; // Bob speed
            const bobOffset = Math.sin(item.data.bobTime) * 4; // Bob amplitude of 4 units
            item.mesh.position.z = item.data.baseZ + bobOffset;

            // Update model lighting based on position (R_LightPoint)
            // Only for MDL items (armor, weapons, powerups) which have MeshBasicMaterial
            if (game.renderer && game.renderer.bspRenderer && game.renderer.aliasRenderer &&
                item.mesh.userData && item.mesh.userData.modelData) {
                const lightLevel = game.renderer.bspRenderer.lightPoint(item.position);
                game.renderer.aliasRenderer.updateShading(item.mesh, lightLevel);
            }
        }
    }
}

/**
 * Drop a backpack containing the player's ammo on death (original Quake items.qc:1636-1684)
 * Called from playerDie in Player.js
 */
export async function dropBackpack(player, game) {
    if (!game.entities) return;

    // Don't drop if player has no ammo worth dropping
    const ammo = player.ammo;
    if (ammo.shells <= 0 && ammo.nails <= 0 && ammo.rockets <= 0 && ammo.cells <= 0) return;

    const backpack = game.entities.spawn();
    if (!backpack) return;

    backpack.classname = 'backpack';
    backpack.category = 'item';
    backpack.position = { ...player.position };
    backpack.moveType = 'toss';
    backpack.solid = 'trigger';
    backpack.hull = {
        mins: { x: -16, y: -16, z: 0 },
        maxs: { x: 16, y: 16, z: 56 }
    };

    // Store ammo contents
    backpack.data.shells = ammo.shells;
    backpack.data.nails = ammo.nails;
    backpack.data.rockets = ammo.rockets;
    backpack.data.cells = ammo.cells;
    backpack.data.weapon = player.currentWeapon;
    backpack.data.rotationAngle = 0;

    // Toss velocity: upward + random horizontal
    backpack.velocity = {
        x: (Math.random() - 0.5) * 200,
        y: (Math.random() - 0.5) * 200,
        z: 300
    };

    // Auto-remove after 120 seconds (original Quake: SUB_Remove nextthink = time + 120)
    backpack.data.removeTime = game.time + 120;

    // Load backpack model
    if (game.renderer) {
        try {
            const modelData = await game.renderer.loadModel('progs/backpack.mdl', game.pak);
            if (modelData) {
                const mesh = game.renderer.createModelInstance(modelData);
                if (mesh) {
                    backpack.mesh = mesh;
                    mesh.position.set(backpack.position.x, backpack.position.y, backpack.position.z);
                    game.renderer.addToScene(mesh);
                }
            }
        } catch (e) {
            // Backpack model may not be available, that's fine
        }
    }

    backpack.touch = (self, other, game) => {
        if (other.classname !== 'player') return;

        // Give ammo to picking-up player
        if (self.data.shells > 0) playerGiveAmmo(other, 'shells', self.data.shells);
        if (self.data.nails > 0) playerGiveAmmo(other, 'nails', self.data.nails);
        if (self.data.rockets > 0) playerGiveAmmo(other, 'rockets', self.data.rockets);
        if (self.data.cells > 0) playerGiveAmmo(other, 'cells', self.data.cells);

        // Give weapon if player doesn't have it
        const weaponFlags = {
            [WEAPON.SUPER_SHOTGUN]: IT.SUPER_SHOTGUN,
            [WEAPON.NAILGUN]: IT.NAILGUN,
            [WEAPON.SUPER_NAILGUN]: IT.SUPER_NAILGUN,
            [WEAPON.GRENADE_LAUNCHER]: IT.GRENADE_LAUNCHER,
            [WEAPON.ROCKET_LAUNCHER]: IT.ROCKET_LAUNCHER,
            [WEAPON.LIGHTNING]: IT.LIGHTNING
        };
        const wpnFlag = weaponFlags[self.data.weapon];
        if (wpnFlag) {
            playerGiveWeapon(other, wpnFlag);
        }

        // Bonus flash and pickup sound
        other.bonusTime = 0.4;
        if (game.audio) {
            game.audio.playLocal('sound/weapons/lock4.wav');
        }

        // Remove backpack
        if (self.mesh && game.renderer) {
            game.renderer.removeFromScene(self.mesh);
        }
        game.entities.remove(self);
    };

    backpack.think = (self, game) => {
        // Auto-remove after timeout
        if (game.time >= self.data.removeTime) {
            if (self.mesh && game.renderer) {
                game.renderer.removeFromScene(self.mesh);
            }
            game.entities.remove(self);
        }
    };
    backpack.nextThink = game.time + 1;

    game.entities.addToCategory(backpack);
    if (game.physics) {
        game.physics.addEntity(backpack);
    }
}
