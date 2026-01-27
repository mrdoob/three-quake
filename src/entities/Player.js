import { PHYSICS } from '../physics/Physics.js';
import { dropBackpack } from '../game/Items.js';

/**
 * Player - Player entity setup and behavior
 */

// Item flags
export const IT = {
    SHOTGUN: 1,
    SUPER_SHOTGUN: 2,
    NAILGUN: 4,
    SUPER_NAILGUN: 8,
    GRENADE_LAUNCHER: 16,
    ROCKET_LAUNCHER: 32,
    LIGHTNING: 64,
    SUPER_LIGHTNING: 128,
    SHELLS: 256,
    NAILS: 512,
    ROCKETS: 1024,
    CELLS: 2048,
    AXE: 4096,
    ARMOR1: 8192,
    ARMOR2: 16384,
    ARMOR3: 32768,
    SUPERHEALTH: 65536,
    KEY1: 131072,
    KEY2: 262144,
    INVISIBILITY: 524288,
    INVULNERABILITY: 1048576,
    SUIT: 2097152,
    QUAD: 4194304
};

// Weapon numbers
export const WEAPON = {
    AXE: 1,
    SHOTGUN: 2,
    SUPER_SHOTGUN: 3,
    NAILGUN: 4,
    SUPER_NAILGUN: 5,
    GRENADE_LAUNCHER: 6,
    ROCKET_LAUNCHER: 7,
    LIGHTNING: 8
};

export function createPlayer(entityManager, position, angles) {
    const player = entityManager.spawn();
    if (!player) return null;

    player.classname = 'player';
    player.category = 'player';

    // Transform
    player.position = { ...position };
    player.angles = { ...angles };
    player.velocity = { x: 0, y: 0, z: 0 };

    // Physics
    player.moveType = 'walk';
    player.solid = 'slidebox';
    player.hull = PHYSICS.HULL_PLAYER;
    player.onGround = false;
    player.jumping = false;
    player.inWater = false;
    player.flags = 0;

    // Water state
    player.waterLevel = 0;  // 0=none, 1=feet, 2=waist, 3=eyes
    player.waterType = -1;  // CONTENTS type
    player.waterJumpTime = 0;
    player.waterJumpDir = null;

    // View effects
    player.viewRoll = 0;  // Camera tilt when strafing
    player.viewHeight = 22;  // Eye height (cl.viewheight) - 22 standing, 12 crouching, 8 dead

    // Stats
    player.health = 100;
    player.maxHealth = 100;
    player.armor = 0;
    player.armorType = 0; // 0=none, 0.3=green, 0.6=yellow, 0.8=red

    // Weapons & ammo
    player.items = IT.AXE | IT.SHOTGUN;
    player.weapons = IT.AXE | IT.SHOTGUN;
    player.currentWeapon = WEAPON.SHOTGUN;
    player.ammo = {
        shells: 25,
        nails: 0,
        rockets: 0,
        cells: 0
    };

    // Input state
    player.input = {
        forward: 0,
        right: 0,
        up: 0,
        jump: false,
        attack: false,
        use: false
    };

    // Attack state
    player.attackFinished = 0;
    player.weaponFrame = 0;

    // View effects
    player.viewBob = 0;
    player.viewKick = 0;
    player.damagePercent = 0;  // 0-150 like original Quake cshift
    player.bonusTime = 0;

    // Power-ups
    player.quadTime = 0;
    player.invincibleTime = 0;
    player.invisibleTime = 0;
    player.suitTime = 0;

    // Powerup warning flags (original Quake client.qc:975-1143)
    player.quadWarningPlayed = false;
    player.invincibleWarningPlayed = false;
    player.invisibleWarningPlayed = false;
    player.suitWarningPlayed = false;

    // Fall damage tracking
    player.lastVelocityZ = 0;
    player.wasOnGround = false;

    entityManager.addToCategory(player);

    return player;
}

export function playerThink(player, game) {
    const time = game.time;

    // Update view bob
    updateViewBob(player, game.deltaTime);

    // Decay view kick
    player.viewKick *= 0.9;

    // Megahealth decay - health above 100 decays by 1 per second
    // Original Quake: megahealth (100 health pickup) can boost above max
    if (player.health > player.maxHealth) {
        if (!player.megahealthDecayTime || time >= player.megahealthDecayTime) {
            player.health -= 1;
            player.megahealthDecayTime = time + 1;
            // Remove superhealth flag when back to normal and trigger item respawn
            if (player.health <= player.maxHealth) {
                player.items &= ~IT.SUPERHEALTH;
                // Trigger megahealth item respawn (original Quake: item respawns when rot finishes)
                if (player.megahealthItem && player.megahealthItem.data) {
                    player.megahealthItem.data.respawnTime = time + 20;
                    player.megahealthItem = null;
                }
            }
        }
    }

    // Update power-up timers with warnings (original Quake client.qc:975-1143)
    updatePowerup(player, game, 'quadTime', IT.QUAD, 'quadWarningPlayed',
        'sound/items/damage2.wav', 'Quad Damage is wearing off');
    updatePowerup(player, game, 'invincibleTime', IT.INVULNERABILITY, 'invincibleWarningPlayed',
        'sound/items/protect2.wav', 'Protection is almost burned out');
    updatePowerup(player, game, 'invisibleTime', IT.INVISIBILITY, 'invisibleWarningPlayed',
        'sound/items/inv2.wav', 'Ring of Shadows magic is fading');
    updatePowerup(player, game, 'suitTime', IT.SUIT, 'suitWarningPlayed',
        'sound/items/suit2.wav', 'Air supply in Biosuit expiring');

    // Check fall damage and landing sounds
    checkFallDamage(player, game);

    // Check for water/drowning damage
    // Original Quake: 12 seconds of air, then 2 damage per second
    checkWaterDamage(player, game);
}

function checkWaterDamage(player, game) {
    // Initialize air supply if needed (12 seconds like original Quake)
    if (player.airFinished === undefined) {
        player.airFinished = game.time + 12;
    }

    // Water level 3 = eyes underwater
    if (player.waterLevel >= 3) {
        // Check for slime/lava damage (waterType from BSP contents)
        // CONTENTS_SLIME = -4, CONTENTS_LAVA = -5
        if (player.waterType === -4) {
            // Slime: 4 damage per second (biosuit protects)
            if (!(player.items & IT.SUIT)) {
                if (!player.nextSlimeDamage || game.time >= player.nextSlimeDamage) {
                    playerTakeDamage(player, 4, null, game);
                    player.nextSlimeDamage = game.time + 1;
                }
            }
        } else if (player.waterType === -5) {
            // Lava: 10 damage per second (biosuit reduces to 2)
            if (!player.nextLavaDamage || game.time >= player.nextLavaDamage) {
                const damage = (player.items & IT.SUIT) ? 2 : 10;
                playerTakeDamage(player, damage, null, game);
                player.nextLavaDamage = game.time + 1;
            }
        } else {
            // Regular water - check drowning
            if (game.time > player.airFinished) {
                // Out of air - take drowning damage
                if (!player.nextDrownDamage || game.time >= player.nextDrownDamage) {
                    playerTakeDamage(player, 2, null, game);
                    player.nextDrownDamage = game.time + 1;

                    // Play drowning sound
                    if (game.audio) {
                        game.audio.playLocal('sound/player/drown1.wav');
                    }
                }
            }
        }
    } else {
        // Above water - restore air supply
        if (player.airFinished < game.time + 12) {
            // Gasp for air if we were nearly drowning
            if (player.airFinished < game.time && game.audio) {
                game.audio.playLocal('sound/player/gasp1.wav');
            }
            player.airFinished = game.time + 12;
        }
    }
}

/**
 * Update a powerup timer with warning sounds (original Quake client.qc CheckPowerups)
 * At 3 seconds remaining: play warning sound, print message, flash screen each second
 */
function updatePowerup(player, game, timeField, itemFlag, warningField, warningSound, warningMessage) {
    if (player[timeField] <= 0) return;

    player[timeField] -= game.deltaTime;

    if (player[timeField] <= 3 && player[timeField] > 0) {
        // Warning phase: last 3 seconds
        if (!player[warningField]) {
            player[warningField] = true;
            if (game.audio) {
                game.audio.playLocal(warningSound);
            }
            if (game.showCenterPrint) {
                game.showCenterPrint(warningMessage);
            }
        }
        // Screen flash each second in last 3 seconds (bf effect)
        // Use floor to detect second transitions
        const prevSec = Math.floor(player[timeField] + game.deltaTime);
        const curSec = Math.floor(player[timeField]);
        if (curSec < prevSec) {
            player.bonusTime = 0.4;
        }
    }

    if (player[timeField] <= 0) {
        player[timeField] = 0;
        player.items &= ~itemFlag;
        player[warningField] = false;
    }
}

/**
 * Check for fall damage and landing sounds (original Quake client.qc PlayerPostThink)
 * velocity.z < -300: landing sound
 * velocity.z < -650: fall damage (5 damage per threshold)
 */
function checkFallDamage(player, game) {
    // Detect ground landing transition
    if (player.onGround && !player.wasOnGround) {
        const fallSpeed = player.lastVelocityZ;

        if (fallSpeed < -650) {
            // Fall damage: 5 damage (original Quake: T_Damage(self, world, world, 5))
            playerTakeDamage(player, 5, null, game);
        }

        if (fallSpeed < -300) {
            // Landing sound
            if (game.audio) {
                if (player.waterLevel >= 1) {
                    // Water landing
                    game.audio.playLocal('sound/player/h2ojump.wav');
                } else {
                    // Ground landing — random between land and land2
                    const sound = Math.random() < 0.5
                        ? 'sound/player/land.wav'
                        : 'sound/player/land2.wav';
                    game.audio.playLocal(sound);
                }
            }
        }
    }

    // Track state for next frame
    player.lastVelocityZ = player.velocity.z;
    player.wasOnGround = player.onGround;
}

function updateViewBob(player, deltaTime) {
    // Calculate bobbing based on velocity
    // Original Quake uses cl_bob (0.02) and cl_bobcycle (0.6)
    const speed = Math.sqrt(
        player.velocity.x * player.velocity.x +
        player.velocity.y * player.velocity.y
    );

    if (player.onGround && speed > 10) {
        // Accumulate bob time based on game time, not system time
        player.bobTime = (player.bobTime || 0) + deltaTime;

        // Bob cycle of 0.6 seconds (like original Quake cl_bobcycle)
        const bobCycle = 0.6;
        const cycle = player.bobTime - Math.floor(player.bobTime / bobCycle) * bobCycle;
        const bobPhase = Math.PI * 2 * cycle / bobCycle;

        // Bob amount scales with speed (like original cl_bob = 0.02)
        const bobScale = Math.min(speed / 320, 1) * 2;
        player.viewBob = Math.sin(bobPhase) * bobScale;
    } else {
        player.viewBob *= 0.9;
    }
}

export function playerTakeDamage(player, damage, attacker, game) {
    // Apply armor - original Quake uses ceil() for armor absorption
    // Armor types: green=0.3 (30%), yellow=0.6 (60%), red=0.8 (80%)
    let save = Math.ceil(damage * player.armorType);
    if (save >= player.armor) {
        save = player.armor;
        player.armor = 0;
        player.armorType = 0;
        player.items &= ~(IT.ARMOR1 | IT.ARMOR2 | IT.ARMOR3);
    } else {
        player.armor -= save;
    }

    // Original Quake uses ceil for final damage too
    const actualDamage = Math.ceil(damage - save);
    player.health -= actualDamage;

    // View kick
    player.viewKick = Math.min(actualDamage * 0.5, 10);

    // Damage flash - original Quake formula from V_ParseDamage
    // count = blood*0.5 + armor*0.5; if (count < 10) count = 10;
    // percent += 3*count; capped at 150
    let count = actualDamage * 0.5 + save * 0.5;
    if (count < 10) count = 10;
    player.damagePercent = Math.min((player.damagePercent || 0) + 3 * count, 150);

    // Play pain sound
    if (game.audio && player.health > 0) {
        const painSounds = [
            'sound/player/pain1.wav',
            'sound/player/pain2.wav',
            'sound/player/pain3.wav',
            'sound/player/pain4.wav',
            'sound/player/pain5.wav',
            'sound/player/pain6.wav'
        ];
        const sound = painSounds[Math.floor(Math.random() * painSounds.length)];
        game.audio.playLocal(sound);
    }

    // Check death
    if (player.health <= 0) {
        playerDie(player, attacker, game);
    }

    return actualDamage;
}

export function playerDie(player, attacker, game) {
    player.health = 0;
    player.moveType = 'none';
    player.solid = 'not';

    // Drop backpack with current ammo (original Quake items.qc DropBackpack)
    dropBackpack(player, game);

    // Play death sound
    if (game.audio) {
        const deathSounds = [
            'sound/player/death1.wav',
            'sound/player/death2.wav',
            'sound/player/death3.wav',
            'sound/player/death4.wav',
            'sound/player/death5.wav'
        ];
        const sound = deathSounds[Math.floor(Math.random() * deathSounds.length)];
        game.audio.playLocal(sound);
    }

    // Trigger respawn timer
    player.respawnTime = game.time + 3.0;
}

export function playerRespawn(player, spawnPoint, game) {
    player.position = { ...spawnPoint };
    player.velocity = { x: 0, y: 0, z: 0 };
    player.angles = { pitch: 0, yaw: 0, roll: 0 };

    player.health = 100;
    player.armor = 0;
    player.armorType = 0;

    player.items = IT.AXE | IT.SHOTGUN;
    player.weapons = IT.AXE | IT.SHOTGUN;
    player.currentWeapon = WEAPON.SHOTGUN;
    player.ammo = { shells: 25, nails: 0, rockets: 0, cells: 0 };

    player.moveType = 'walk';
    player.solid = 'slidebox';
}

export function playerGiveWeapon(player, weaponFlag) {
    player.items |= weaponFlag;
    player.weapons |= weaponFlag;
}

export function playerGiveAmmo(player, ammoType, amount) {
    const maxAmmo = {
        shells: 100,
        nails: 200,
        rockets: 100,
        cells: 100
    };

    player.ammo[ammoType] = Math.min(
        player.ammo[ammoType] + amount,
        maxAmmo[ammoType]
    );
}

export function playerGiveHealth(player, amount, max = 100) {
    if (player.health >= max) return false;

    player.health = Math.min(player.health + amount, max);
    return true;
}

export function playerGiveArmor(player, amount, type) {
    // Armor types: 0.3 = green, 0.6 = yellow, 0.8 = red
    if (type < player.armorType) return false;

    const newArmor = amount;
    if (player.armorType === type && player.armor >= newArmor) {
        return false;
    }

    player.armor = newArmor;
    player.armorType = type;

    // Set item flag
    player.items &= ~(IT.ARMOR1 | IT.ARMOR2 | IT.ARMOR3);
    if (type === 0.3) player.items |= IT.ARMOR1;
    else if (type === 0.6) player.items |= IT.ARMOR2;
    else if (type === 0.8) player.items |= IT.ARMOR3;

    return true;
}

export function playerSelectWeapon(player, weaponNum, game = null) {
    const weaponFlags = {
        [WEAPON.AXE]: IT.AXE,
        [WEAPON.SHOTGUN]: IT.SHOTGUN,
        [WEAPON.SUPER_SHOTGUN]: IT.SUPER_SHOTGUN,
        [WEAPON.NAILGUN]: IT.NAILGUN,
        [WEAPON.SUPER_NAILGUN]: IT.SUPER_NAILGUN,
        [WEAPON.GRENADE_LAUNCHER]: IT.GRENADE_LAUNCHER,
        [WEAPON.ROCKET_LAUNCHER]: IT.ROCKET_LAUNCHER,
        [WEAPON.LIGHTNING]: IT.LIGHTNING
    };

    const flag = weaponFlags[weaponNum];
    if (flag && (player.weapons & flag)) {
        // Don't switch to same weapon
        if (player.currentWeapon === weaponNum) {
            return false;
        }

        player.currentWeapon = weaponNum;
        player.weaponFrame = 0;

        // Weapon switch delay - can't fire immediately after switching
        // Original Quake uses about 0.3 seconds
        if (game) {
            player.attackFinished = Math.max(player.attackFinished, game.time + 0.3);
        }

        return true;
    }

    return false;
}
