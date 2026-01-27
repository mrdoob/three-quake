/**
 * Monster - AI behavior for enemies
 *
 * Implements basic Quake monster AI states:
 * - STAND: Idle, checking for enemies
 * - WALK: Patrolling a path
 * - RUN: Moving toward enemy
 * - ATTACK: Attacking enemy
 * - PAIN: Flinching from damage
 * - DIE: Death animation
 */

// Monster states
export const MONSTER_STATE = {
    STAND: 'stand',
    WALK: 'walk',
    RUN: 'run',
    ATTACK: 'attack',
    PAIN: 'pain',
    DIE: 'die'
};

// Range constants from ai.qc
const RANGE_MELEE = 0;  // < 120 units
const RANGE_NEAR = 1;   // < 500 units
const RANGE_MID = 2;    // < 1000 units
const RANGE_FAR = 3;    // >= 1000 units

// Calculate range category like original Quake (ai.qc:range)
function getRange(dist) {
    if (dist < 120) return RANGE_MELEE;
    if (dist < 500) return RANGE_NEAR;
    if (dist < 1000) return RANGE_MID;
    return RANGE_FAR;
}

// Quake's random damage formula: (random()+random()+random()) * multiplier
// This creates a bell curve centered around 1.5 * multiplier
function randomDamage(multiplier) {
    return (Math.random() + Math.random() + Math.random()) * multiplier;
}

// Normalize angle to 0-360 range (ai.qc:anglemod)
function anglemod(a) {
    a = a % 360;
    if (a < 0) a += 360;
    return a;
}

// Gradual yaw turning (ai.qc:ChangeYaw)
// Turns monster.angles.yaw toward monster.data.idealYaw by at most yawSpeed degrees
function changeYaw(monster) {
    const current = anglemod(monster.angles.yaw);
    const ideal = anglemod(monster.data.idealYaw);
    const speed = monster.data.yawSpeed;

    if (current === ideal) return;

    let move = ideal - current;
    if (move > 0) {
        if (move > 180) move -= 360;
    } else {
        if (move < -180) move += 360;
    }

    if (move > 0) {
        if (move > speed) move = speed;
    } else {
        if (move < -speed) move = -speed;
    }

    monster.angles.yaw = anglemod(current + move);
}

// Check if monster is facing its ideal yaw within tolerance (ai.qc:FacingIdeal)
function facingIdeal(monster) {
    const delta = anglemod(monster.data.idealYaw - monster.angles.yaw);
    // Within 45 degrees (checking both directions of wraparound)
    return delta < 45 || delta > 315;
}

// Check if monster has a clear shot to its enemy (fight.qc:CheckAttack traceline)
// Traces from monster eyes to enemy eyes. Returns false if blocked by world geometry.
function hasClearShot(monster, game) {
    if (!monster.enemy) return false;
    const def = monster.data?.monsterDef;
    const viewHeight = def?.viewHeight || 25;

    const start = {
        x: monster.position.x,
        y: monster.position.y,
        z: monster.position.z + viewHeight
    };
    const end = {
        x: monster.enemy.position.x,
        y: monster.enemy.position.y,
        z: monster.enemy.position.z + 22
    };

    const trace = game.physics.traceLine(start, end);

    // Original: if (trace_ent != targ) return FALSE
    // Also: if (trace_inopen && trace_inwater) return FALSE (sight crosses water surface)
    if (trace.fraction === 1.0) return true;
    if (trace.entity && trace.entity === monster.enemy) return true;
    return false;
}

// Monster definitions - all values from original QuakeC source
// Hull sizes from original Quake:
// setsize('-16 -16 -24', '16 16 40') - standard monsters
// VEC_HULL2_MIN = '-32 -32 -24', VEC_HULL2_MAX = '32 32 64' - large monsters
export const MONSTER_TYPES = {
    'monster_army': {
        name: 'Grunt',
        model: 'progs/soldier.mdl',
        health: 30,
        // soldier.qc: setsize(self, '-16 -16 -24', '16 16 40')
        size: { mins: { x: -16, y: -16, z: -24 }, maxs: { x: 16, y: 16, z: 40 } },
        speed: 250,
        attackType: 'hitscan',
        damage: 4,  // FireBullets(4, dir, '0.1 0.1 0')
        gibThreshold: -35,  // soldier.qc: if (self.health < -35)
        dropAmmo: { type: 'shells', count: 5 },
        sightSound: 'soldier/sight1.wav',
        painSound: 'soldier/pain1.wav',
        painSound2: 'soldier/pain2.wav',
        deathSound: 'soldier/death1.wav',
        viewHeight: 25
    },
    'monster_dog': {
        name: 'Rottweiler',
        model: 'progs/dog.mdl',
        health: 25,
        // dog.qc: setsize(self, '-32 -32 -24', '32 32 40') - dogs are wide!
        size: { mins: { x: -32, y: -32, z: -24 }, maxs: { x: 32, y: 32, z: 40 } },
        speed: 300,
        attackType: 'melee',
        attackType2: 'leap',  // Dogs can leap too
        // dog.qc: dog_bite - (random()+random()+random()) * 8
        meleeDamageMultiplier: 8,
        // dog.qc: Dog_JumpTouch - 10 + 10*random() when vel > 300
        leapDamage: { base: 10, random: 10, minVelocity: 300 },
        leapVelocity: { forward: 300, up: 200 },
        leapRange: { min: 80, max: 150 },
        gibThreshold: -35,
        sightSound: 'dog/dsight.wav',
        painSound: 'dog/dpain1.wav',
        deathSound: 'dog/ddeath.wav',
        attackSound: 'dog/dattack1.wav',
        viewHeight: 25
    },
    'monster_ogre': {
        name: 'Ogre',
        model: 'progs/ogre.mdl',
        health: 200,
        // VEC_HULL2
        size: { mins: { x: -32, y: -32, z: -24 }, maxs: { x: 32, y: 32, z: 64 } },
        speed: 200,
        attackType: 'grenade',
        attackType2: 'chainsaw',  // Melee attack
        damage: 40,  // Grenade radius damage
        // ogre.qc: chainsaw - (random()+random()+random()) * 4
        meleeDamageMultiplier: 4,
        meleeRange: 100,
        gibThreshold: -80,  // ogre.qc: if (self.health < -80)
        dropAmmo: { type: 'rockets', count: 2 },
        sightSound: 'ogre/ogwake.wav',
        painSound: 'ogre/ogpain1.wav',
        deathSound: 'ogre/ogdth.wav',
        idleSound: 'ogre/ogidle.wav',
        idleSound2: 'ogre/ogidle2.wav',
        dragSound: 'ogre/ogdrag.wav',
        sawSound: 'ogre/ogsawatk.wav',
        yawSpeed: 30,  // Ogre turns faster than default (ai.qc)
        viewHeight: 25
    },
    'monster_knight': {
        name: 'Knight',
        model: 'progs/knight.mdl',
        health: 75,
        // knight.qc: setsize(self, '-16 -16 -24', '16 16 40')
        size: { mins: { x: -16, y: -16, z: -24 }, maxs: { x: 16, y: 16, z: 40 } },
        speed: 250,
        attackType: 'melee',
        // knight.qc: ai_melee - (random()+random()+random()) * 3
        meleeDamageMultiplier: 3,
        meleeRange: 60,
        gibThreshold: -40,
        sightSound: 'knight/ksight.wav',
        painSound: 'knight/khurt.wav',
        deathSound: 'knight/kdeath.wav',
        swordSound1: 'knight/sword1.wav',
        swordSound2: 'knight/sword2.wav',
        idleSound: 'knight/idle.wav',
        viewHeight: 25
    },
    'monster_demon1': {
        name: 'Fiend',
        model: 'progs/demon.mdl',
        health: 300,
        // VEC_HULL2
        size: { mins: { x: -32, y: -32, z: -24 }, maxs: { x: 32, y: 32, z: 64 } },
        speed: 300,
        attackType: 'leap',
        attackType2: 'melee',
        // demon.qc: Demon_Melee - 10 + 5*random()
        meleeDamage: { base: 10, random: 5 },
        meleeRange: 100,
        // demon.qc: Demon_JumpTouch - 40 + 10*random() when vel > 400
        leapDamage: { base: 40, random: 10, minVelocity: 400 },
        // demon.qc: self.velocity = v_forward * 600 + '0 0 250'
        leapVelocity: { forward: 600, up: 250 },
        // demon.qc: CheckDemonJump - d < 100 return FALSE, d > 200 && random() < 0.9 return FALSE
        leapRange: { min: 100, max: 200 },
        gibThreshold: -80,  // demon.qc: if (self.health < -80)
        // demon.qc: random()*200 > damage to skip pain
        painThreshold: 200,
        sightSound: 'demon/sight2.wav',
        painSound: 'demon/dpain1.wav',
        deathSound: 'demon/ddeath.wav',
        hitSound: 'demon/dhit2.wav',
        leapSound: 'demon/djump.wav',
        idleSound: 'demon/idle1.wav',
        viewHeight: 25
    },
    'monster_wizard': {
        name: 'Scrag',
        model: 'progs/wizard.mdl',
        health: 80,
        size: { mins: { x: -16, y: -16, z: -24 }, maxs: { x: 16, y: 16, z: 40 } },
        speed: 300,
        attackType: 'projectile',
        damage: 9,  // Wizard spit damage
        flying: true,
        gibThreshold: -40,
        sightSound: 'wizard/wsight.wav',
        painSound: 'wizard/wpain.wav',
        deathSound: 'wizard/wdeath.wav',
        attackSound: 'wizard/wattack.wav',
        idleSound: 'wizard/widle1.wav',
        viewHeight: 25
    },
    'monster_zombie': {
        name: 'Zombie',
        model: 'progs/zombie.mdl',
        health: 60,
        size: { mins: { x: -16, y: -16, z: -24 }, maxs: { x: 16, y: 16, z: 40 } },
        speed: 100,
        attackType: 'throw',
        damage: 10,
        gibOnly: true,  // Can only be killed by gibbing
        gibThreshold: -40,
        sightSound: 'zombie/z_idle.wav',
        painSound: 'zombie/z_pain.wav',
        deathSound: 'zombie/z_gib.wav',
        viewHeight: 25
    },
    'monster_shambler': {
        name: 'Shambler',
        model: 'progs/shambler.mdl',
        health: 600,
        // VEC_HULL2
        size: { mins: { x: -32, y: -32, z: -24 }, maxs: { x: 32, y: 32, z: 64 } },
        speed: 200,
        attackType: 'lightning',
        attackType2: 'melee',
        // shambler.qc: CastLightning - 10 damage per bolt, 3-4 bolts
        lightningDamage: 10,
        lightningRange: 600,
        // shambler.qc: sham_smash10 - (random()+random()+random()) * 40
        smashDamageMultiplier: 40,
        // shambler.qc: ShamClaw - (random()+random()+random()) * 20
        clawDamageMultiplier: 20,
        meleeRange: 100,
        gibThreshold: -60,  // shambler.qc: if (self.health < -60)
        halfDamageFromExplosion: true,
        // shambler.qc: random()*400 > damage to skip pain
        painThreshold: 400,
        sightSound: 'shambler/ssight.wav',
        painSound: 'shambler/shurt2.wav',
        deathSound: 'shambler/sdeath.wav',
        attackSound: 'shambler/sattck1.wav',
        boomSound: 'shambler/sboom.wav',
        smackSound: 'shambler/smack.wav',
        meleeSound1: 'shambler/melee1.wav',
        meleeSound2: 'shambler/melee2.wav',
        idleSound: 'shambler/sidle.wav',
        viewHeight: 25
    },
    'monster_hell_knight': {
        name: 'Death Knight',
        model: 'progs/hknight.mdl',
        health: 250,
        size: { mins: { x: -16, y: -16, z: -24 }, maxs: { x: 16, y: 16, z: 40 } },
        speed: 250,
        attackType: 'projectile',
        attackType2: 'melee',
        damage: 9,  // Per magic missile (fires 3)
        // hknight.qc: ai_melee - (random()+random()+random()) * 3
        meleeDamageMultiplier: 3,
        gibThreshold: -40,
        sightSound: 'hknight/sight1.wav',
        painSound: 'hknight/pain1.wav',
        deathSound: 'hknight/death1.wav',
        attackSound: 'hknight/attack1.wav',
        slashSound: 'hknight/slash1.wav',
        idleSound: 'hknight/idle.wav',
        viewHeight: 25
    },
    'monster_enforcer': {
        name: 'Enforcer',
        model: 'progs/enforcer.mdl',
        health: 80,
        size: { mins: { x: -16, y: -16, z: -24 }, maxs: { x: 16, y: 16, z: 40 } },
        speed: 250,
        attackType: 'laser',  // Enforcer fires lasers, not hitscan
        damage: 15,  // enforcer.qc: 15 damage per laser
        gibThreshold: -35,
        dropAmmo: { type: 'cells', count: 5 },
        // enforcer.qc: uses random sight sounds
        sightSounds: ['enforcer/sight1.wav', 'enforcer/sight2.wav', 'enforcer/sight3.wav', 'enforcer/sight4.wav'],
        painSound: 'enforcer/pain1.wav',
        painSound2: 'enforcer/pain2.wav',
        deathSound: 'enforcer/death1.wav',
        attackSound: 'enforcer/enfire.wav',
        idleSound: 'enforcer/idle1.wav',
        viewHeight: 25
    },
    'monster_shalrath': {
        name: 'Vore',
        model: 'progs/shalrath.mdl',
        health: 400,
        // VEC_HULL2
        size: { mins: { x: -32, y: -32, z: -24 }, maxs: { x: 32, y: 32, z: 64 } },
        speed: 200,
        attackType: 'homing',  // Vore pods home on target
        damage: 40,
        gibThreshold: -90,
        sightSound: 'shalrath/sight.wav',
        painSound: 'shalrath/pain.wav',
        deathSound: 'shalrath/death.wav',
        attackSound: 'shalrath/attack.wav',
        idleSound: 'shalrath/idle.wav',
        viewHeight: 25
    },
    'monster_tarbaby': {
        name: 'Spawn',
        model: 'progs/tarbaby.mdl',
        health: 80,
        size: { mins: { x: -16, y: -16, z: -24 }, maxs: { x: 16, y: 16, z: 24 } },
        speed: 300,
        attackType: 'leap',
        // tarbaby.qc: explodes on death dealing radius damage
        explosionDamage: 40,
        explosionRadius: 120,
        leapVelocity: { forward: 400, up: 200 },
        gibThreshold: -40,
        sightSound: 'blob/sight1.wav',
        painSound: 'blob/hit1.wav',
        deathSound: 'blob/death1.wav',
        leapSound: 'blob/land1.wav',
        viewHeight: 10
    },
    'monster_fish': {
        name: 'Rotfish',
        model: 'progs/fish.mdl',
        health: 25,
        size: { mins: { x: -16, y: -16, z: -24 }, maxs: { x: 16, y: 16, z: 24 } },
        speed: 200,
        attackType: 'melee',
        // fish.qc: (random() + random()) * 3
        meleeDamageMultiplier: 3,
        swimming: true,
        gibThreshold: -35,
        sightSound: null,
        painSound: null,  // Fish are silent
        deathSound: null,
        viewHeight: 10
    }
};

export async function createMonster(entityManager, classname, position, angles, game) {
    const monsterDef = MONSTER_TYPES[classname];
    if (!monsterDef) {
        console.warn(`Unknown monster type: ${classname}`);
        return null;
    }

    const monster = entityManager.spawn();
    if (!monster) return null;

    monster.classname = classname;
    monster.category = 'monster';

    monster.position = { ...position };
    monster.angles = angles ? { ...angles } : { pitch: 0, yaw: 0, roll: 0 };
    monster.velocity = { x: 0, y: 0, z: 0 };

    monster.moveType = monsterDef.flying ? 'fly' : 'step';
    monster.solid = 'slidebox';
    monster.hull = monsterDef.size;

    monster.health = monsterDef.health;
    monster.maxHealth = monsterDef.health;

    monster.state = MONSTER_STATE.STAND;
    monster.enemy = null;
    monster.goalEntity = null;
    monster.movetarget = null;  // Current path_corner target

    monster.data.monsterDef = monsterDef;
    monster.data.lastSightTime = 0;
    monster.data.attackTime = 0;
    monster.data.attackFinished = 0;
    monster.data.painTime = 0;
    monster.data.currentAnim = 'stand';
    monster.data.pathWaitTime = 0;  // Time to wait at path_corner

    // Gradual yaw turning (ai.qc:ChangeYaw)
    monster.data.idealYaw = monster.angles.yaw;
    monster.data.yawSpeed = monsterDef.yawSpeed || 20;  // degrees per 0.1s think

    // Attack state machine (ai.qc: AS_STRAIGHT/AS_SLIDING/AS_MELEE/AS_MISSILE)
    monster.data.attackState = 'straight';  // 'straight', 'melee', 'missile', 'sliding'
    monster.data.lefty = false;  // Strafe direction for AS_SLIDING
    monster.data.flags = 0;  // FL_PARTIALGROUND = 1

    monster.think = monsterThink;
    monster.nextThink = game.time + 0.1;

    // Load model and create mesh
    if (game.renderer && game.renderer.aliasRenderer) {
        try {
            const modelData = await game.renderer.loadModel(monsterDef.model, game.pak);
            if (modelData) {
                const mesh = game.renderer.createModelInstance(modelData);
                if (mesh) {
                    monster.mesh = mesh;
                    monster.data.modelData = modelData;

                    // Set initial position and rotation
                    mesh.position.set(position.x, position.y, position.z);
                    mesh.rotation.z = (angles?.yaw || 0) * Math.PI / 180;

                    game.renderer.addToScene(mesh);
                }
            }
        } catch (e) {
            console.warn(`Failed to load monster model ${monsterDef.model}:`, e);
        }
    }

    entityManager.addToCategory(monster);

    // Add to physics for collision
    if (game.physics) {
        game.physics.addEntity(monster);
    }

    console.log(`Spawned ${monsterDef.name} at (${position.x.toFixed(0)}, ${position.y.toFixed(0)}, ${position.z.toFixed(0)}) - mesh: ${monster.mesh ? 'loaded' : 'missing'}`);

    return monster;
}

/**
 * Initialize monster pathing after all entities are spawned
 * Called from EntitySpawner after spawnEntities completes
 */
export function initializeMonsterPathing(game) {
    if (!game.pathCorners || game.pathCorners.length === 0) return;

    for (const monster of game.entities.monsters) {
        if (!monster.active || !monster.target) continue;

        // Find the path_corner matching this monster's target
        const pathCorner = game.pathCorners.find(pc => pc.targetname === monster.target);
        if (pathCorner) {
            monster.movetarget = pathCorner;
            monster.goalEntity = pathCorner;
            monster.state = MONSTER_STATE.WALK;
            console.log(`Monster ${monster.classname} will patrol to path_corner ${pathCorner.targetname}`);
        }
    }
}

function monsterThink(monster, game) {
    // Variable think timing based on state (like original Quake)
    // Standing monsters think less frequently to save CPU
    // Active combat requires faster thinking
    let thinkInterval;
    switch (monster.state) {
        case MONSTER_STATE.STAND:
            thinkInterval = 0.2;  // Idle - slower checks
            break;
        case MONSTER_STATE.WALK:
            thinkInterval = 0.1;  // Patrolling
            break;
        case MONSTER_STATE.RUN:
            thinkInterval = 0.1;  // Combat - responsive
            break;
        case MONSTER_STATE.ATTACK:
            // Attack timing varies by weapon type
            const def = monster.data.monsterDef;
            if (def.attackType === 'melee' || def.attackType === 'leap') {
                thinkInterval = 0.05;  // Melee needs fast collision checks
            } else {
                thinkInterval = 0.1;   // Ranged attacks
            }
            break;
        case MONSTER_STATE.PAIN:
            thinkInterval = 0.1;
            break;
        default:
            thinkInterval = 0.1;
    }
    monster.nextThink = game.time + thinkInterval;

    // Gradual yaw turning (ai.qc:ChangeYaw) - called every think
    changeYaw(monster);

    // Update mesh position and rotation
    if (monster.mesh) {
        monster.mesh.position.set(
            monster.position.x,
            monster.position.y,
            monster.position.z
        );
        monster.mesh.rotation.z = monster.angles.yaw * Math.PI / 180;
    }

    // Don't think if dead
    if (monster.health <= 0) {
        setAnimation(monster, 'death', game);
        return;
    }

    // Check for leap attack collision (demon.qc:Demon_JumpTouch, dog.qc:Dog_JumpTouch)
    if (monster.data.leaping) {
        // Check if landed
        if (monster.onGround) {
            monster.data.leaping = false;
            monster.state = MONSTER_STATE.RUN;
        } else {
            // Check collision with entities during leap
            const targets = [...game.entities.players, ...game.entities.monsters];
            for (const target of targets) {
                if (target === monster) continue;
                if (target.health <= 0) continue;

                const dx = target.position.x - monster.position.x;
                const dy = target.position.y - monster.position.y;
                const dz = target.position.z - monster.position.z;
                const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

                // Close enough to deal leap damage
                if (dist < 64) {
                    // Check velocity threshold (demon.qc: vel > 400, dog.qc: vel > 300)
                    const vel = Math.sqrt(
                        monster.velocity.x * monster.velocity.x +
                        monster.velocity.y * monster.velocity.y +
                        monster.velocity.z * monster.velocity.z
                    );
                    const minVel = monster.data.leapMinVelocity || 400;

                    if (vel > minVel) {
                        // Calculate damage: base + random * multiplier
                        const base = monster.data.leapDamageBase || 40;
                        const randomMult = monster.data.leapDamageRandom || 10;
                        const damage = base + Math.random() * randomMult;
                        game.dealDamage(target, Math.floor(damage), monster);
                    }

                    monster.data.leaping = false;
                    break;
                }
            }
        }
    }

    // Clear cached attack animation name when leaving ATTACK state
    if (monster.state !== MONSTER_STATE.ATTACK) {
        monster.data.attackAnimName = null;
    }

    switch (monster.state) {
        case MONSTER_STATE.STAND:
            setAnimation(monster, getStateAnimName(monster, 'stand'), game);
            monsterStand(monster, game);
            break;
        case MONSTER_STATE.WALK:
            setAnimation(monster, getStateAnimName(monster, 'walk'), game);
            monsterWalk(monster, game);
            break;
        case MONSTER_STATE.RUN:
            setAnimation(monster, getStateAnimName(monster, 'run'), game);
            monsterRun(monster, game);
            break;
        case MONSTER_STATE.ATTACK:
            setAnimation(monster, getAttackAnimName(monster), game);
            monsterAttack(monster, game);
            break;
        case MONSTER_STATE.PAIN:
            setAnimation(monster, 'pain', game);
            monsterPain(monster, game);
            break;
    }
}

/**
 * Map generic state names to the actual MDL frame prefixes per monster.
 * Most monsters use "stand", "walk", "run" directly, but some don't:
 *  - wizard: hover (stand/walk), fly (run)
 *  - knight: runb (run)
 *  - soldier: prowl_ (walk)
 *  - tarbaby: walk (stand — no dedicated stand frames)
 */
function getStateAnimName(monster, state) {
    const cls = monster.classname;

    if (state === 'stand') {
        if (cls === 'monster_wizard') return 'hover';
        if (cls === 'monster_tarbaby') return 'walk';
    } else if (state === 'walk') {
        if (cls === 'monster_wizard') return 'hover';
        if (cls === 'monster_army') return 'prowl_';
    } else if (state === 'run') {
        if (cls === 'monster_wizard') return 'fly';
        if (cls === 'monster_knight') return 'runb';
    }

    return state;
}

/**
 * Resolve the correct MDL animation name for a monster's current attack.
 *
 * The MDL frame names vary per monster (e.g. ogre uses "shoot" for grenade,
 * wizard uses "magatt", soldier uses "shoot"). The AliasRenderer groups
 * frames by name prefix, so we need to return the exact prefix that matches
 * the MDL frame names for each monster+attackType combination.
 *
 * The result is cached in monster.data.attackAnimName so random choices
 * (hell_knight magic variant, zombie throw variant) are stable per attack.
 * Cleared when leaving ATTACK state.
 */
function getAttackAnimName(monster) {
    // Return cached name if already resolved for this attack
    if (monster.data.attackAnimName) return monster.data.attackAnimName;

    const attackType = monster.data.attackType;
    const cls = monster.classname;
    let name;

    switch (cls) {
        case 'monster_army':       // soldier.mdl: shoot1-9
            name = 'shoot'; break;

        case 'monster_ogre':
            if (attackType === 'chainsaw_swing') { name = 'swing'; break; }   // swing1-14
            if (attackType === 'chainsaw_smash') { name = 'smash'; break; }   // smash1-14
            name = 'shoot'; break;  // shoot1-6 (grenade)

        case 'monster_wizard':     // wizard.mdl: magatt1-13
            name = 'magatt'; break;

        case 'monster_hell_knight': {
            if (attackType === 'melee') {
                // hknight has slice, smash, w_attack - pick randomly like QC
                const r = Math.random();
                if (r < 0.33) name = 'slice';
                else if (r < 0.66) name = 'smash';
                else name = 'w_attack';
                break;
            }
            if (attackType === 'knight_charge') { name = 'char_a'; break; }
            // Ranged magic: magica, magicb, magicc - pick randomly
            const magicR = Math.random();
            if (magicR < 0.33) name = 'magica';
            else if (magicR < 0.66) name = 'magicb';
            else name = 'magicc';
            break;
        }

        case 'monster_knight':
            if (attackType === 'knight_charge') { name = 'runattack'; break; } // runattack1-11
            name = 'attackb'; break;  // attackb1-10 (standing melee)

        case 'monster_demon1':
            if (attackType === 'leap') { name = 'leap'; break; }    // leap1-12
            name = 'attacka'; break;  // attacka1-15 (melee claw)

        case 'monster_dog':
            if (attackType === 'leap') { name = 'leap'; break; }    // leap1-9
            name = 'attack'; break;   // attack1-8

        case 'monster_zombie': {
            // zombie.qc: random choice of atta, attb, attc
            const zombieR = Math.random();
            if (zombieR < 0.33) name = 'atta';
            else if (zombieR < 0.66) name = 'attb';
            else name = 'attc';
            break;
        }

        case 'monster_tarbaby':    // tarbaby.mdl: jump1-6
            name = 'jump'; break;

        case 'monster_shambler':
            if (attackType === 'smash') { name = 'smash'; break; }        // smash1-11
            if (attackType === 'claw_right') { name = 'swingr'; break; }  // swingr1-9
            if (attackType === 'claw_left') { name = 'swingl'; break; }   // swingl1-9
            name = 'magic'; break;  // magic1-15 (lightning)

        case 'monster_enforcer':   // enforcer.mdl: attack1-10
            name = 'attack'; break;

        case 'monster_shalrath':   // shalrath.mdl: attack1-11
            name = 'attack'; break;

        case 'monster_fish':       // fish.mdl: attack1-?
            name = 'attack'; break;

        default:
            name = 'attack'; break;
    }

    monster.data.attackAnimName = name;
    return name;
}

function setAnimation(monster, animName, game) {
    if (monster.data.currentAnim === animName) return;

    monster.data.currentAnim = animName;

    if (monster.mesh && game.renderer && game.renderer.aliasRenderer) {
        game.renderer.aliasRenderer.setAnimation(monster.mesh, animName);
    }
}

function monsterStand(monster, game) {
    // Check for player visibility
    if (findEnemy(monster, game)) {
        foundTarget(monster, game);
    }
}

// Called when a monster first spots the player (ai.qc:FoundTarget / HuntTarget)
function foundTarget(monster, game) {
    monster.state = MONSTER_STATE.RUN;
    monster.data.attackState = 'straight';
    // HuntTarget: SUB_AttackFinished(1) — 1 second delay before first attack
    monster.data.attackFinished = game.time + 1.0;
    playSightSound(monster, game);
}

// Play monster sight sound (ai.qc:SightSound)
function playSightSound(monster, game) {
    const def = monster.data.monsterDef;
    if (!game.audio) return;

    // Enforcer uses random sight sounds
    if (def.sightSounds && def.sightSounds.length > 0) {
        const idx = Math.floor(Math.random() * def.sightSounds.length);
        game.audio.playPositioned(`sound/${def.sightSounds[idx]}`, monster.position);
    } else if (def.sightSound) {
        game.audio.playPositioned(`sound/${def.sightSound}`, monster.position);
    }
}

function monsterWalk(monster, game) {
    // Patrol behavior - move toward goal entity (path_corner)
    if (findEnemy(monster, game)) {
        foundTarget(monster, game);
        return;
    }

    // Play idle/walk sounds occasionally
    const def = monster.data.monsterDef;
    if (game.audio) {
        // Ogre drags chainsaw while walking (ogre.qc:ogre_walk1)
        if (monster.classname === 'monster_ogre' && def.dragSound) {
            if (Math.random() < 0.05) {
                game.audio.playPositioned(`sound/${def.dragSound}`, monster.position, 1.0, 2.0);
            }
        }
        // Other monsters have idle sounds
        else if (def.idleSound && Math.random() < 0.02) {
            game.audio.playPositioned(`sound/${def.idleSound}`, monster.position, 1.0, 2.0);
        }
    }

    // Check if waiting at a path_corner
    if (monster.data.pathWaitTime > 0) {
        if (game.time < monster.data.pathWaitTime) {
            // Still waiting, stop movement
            monster.velocity.x = 0;
            monster.velocity.y = 0;
            return;
        }
        monster.data.pathWaitTime = 0;
    }

    // Move toward goal if any
    if (monster.movetarget) {
        const def = monster.data.monsterDef;
        // Patrol at slower speed (original Quake uses 8-10 units/frame, ~80-100 units/sec)
        const walkSpeed = Math.min(def.speed * 0.4, 100);
        faceEntity(monster, monster.movetarget);
        moveToGoal(monster, walkSpeed * 0.1, game);

        // Check if reached path_corner (within 16 units)
        const dx = monster.movetarget.position.x - monster.position.x;
        const dy = monster.movetarget.position.y - monster.position.y;
        const distSq = dx * dx + dy * dy;

        if (distSq < 16 * 16) {
            // Reached the path_corner - go to next one
            const currentCorner = monster.movetarget;

            // Wait at corner if specified
            if (currentCorner.wait > 0) {
                monster.data.pathWaitTime = game.time + currentCorner.wait;
                monster.velocity.x = 0;
                monster.velocity.y = 0;
            }

            // Find next path_corner
            if (currentCorner.target && game.pathCorners) {
                const nextCorner = game.pathCorners.find(pc => pc.targetname === currentCorner.target);
                if (nextCorner) {
                    monster.movetarget = nextCorner;
                    monster.goalEntity = nextCorner;
                } else {
                    // No next corner, stay at current or switch to stand
                    monster.movetarget = null;
                    monster.goalEntity = null;
                    monster.state = MONSTER_STATE.STAND;
                }
            } else {
                // No target, switch to stand
                monster.movetarget = null;
                monster.goalEntity = null;
                monster.state = MONSTER_STATE.STAND;
            }
        }
    } else if (monster.goalEntity) {
        // Legacy goalEntity support (non-path_corner)
        faceEntity(monster, monster.goalEntity);
        moveToGoal(monster, 10, game);
    } else {
        // No goal, just stand
        monster.state = MONSTER_STATE.STAND;
    }
}

function monsterRun(monster, game) {
    // Check if enemy is still valid (ai.qc:ai_run)
    if (!monster.enemy || monster.enemy.health <= 0) {
        monster.enemy = null;
        // Check for old enemy (infighting support)
        if (monster.data.oldenemy && monster.data.oldenemy.health > 0) {
            monster.enemy = monster.data.oldenemy;
            monster.data.oldenemy = null;
        } else {
            monster.data.attackState = 'straight';
            monster.state = MONSTER_STATE.STAND;
            return;
        }
    }

    const def = monster.data.monsterDef;

    // Check visibility
    monster.data.enemyVisible = canSeeEntity(monster, monster.enemy, game, false);
    if (monster.data.enemyVisible) {
        monster.data.searchTime = game.time + 5;
        // Face enemy when visible
        faceEntity(monster, monster.enemy);
    }

    // Lost sight of enemy for too long
    if (!monster.data.enemyVisible && game.time > (monster.data.searchTime || 0)) {
        monster.enemy = null;
        monster.data.attackState = 'straight';
        monster.state = MONSTER_STATE.STAND;
        return;
    }

    // Calculate range to enemy
    const dist = distanceTo(monster, monster.enemy);
    const range = getRange(dist);
    monster.data.enemyRange = range;

    // Check for attack (fight.qc:CheckAnyAttack logic)
    if (monster.data.enemyVisible && game.time >= (monster.data.attackFinished || 0)) {
        checkMonsterAttack(monster, range, dist, game);
    }

    // Dispatch based on attack state (ai.qc:ai_run)
    if (monster.data.attackState === 'melee') {
        // ai_run_melee: turn toward enemy, attack when facing
        faceEntity(monster, monster.enemy);
        if (facingIdeal(monster)) {
            monster.state = MONSTER_STATE.ATTACK;
            monster.data.attackType = 'melee';
            monster.data.attackTime = game.time + 0.3;
            monster.data.attackState = 'straight';
        }
        return;
    }

    if (monster.data.attackState === 'missile') {
        // ai_run_missile: turn toward enemy, attack when facing
        faceEntity(monster, monster.enemy);
        if (facingIdeal(monster)) {
            monster.state = MONSTER_STATE.ATTACK;
            // attackType was already set by the check function
            monster.data.attackState = 'straight';
        }
        return;
    }

    if (monster.data.attackState === 'sliding') {
        // ai_run_slide: strafe perpendicular to enemy, maintain range
        aiRunSlide(monster, game);
        return;
    }

    // Default: move toward enemy (ai_run_straight)
    if (def.flying && monster.classname === 'monster_wizard') {
        moveWizard(monster, monster.enemy.position, def.speed, game);
    } else {
        faceEntity(monster, monster.enemy);
        moveToGoal(monster, def.speed * 0.1, game);
    }

    // Play idle sounds occasionally
    if (Math.random() < 0.02 && def.idleSound && game.audio) {
        game.audio.playPositioned(`sound/${def.idleSound}`, monster.position, 1.0, 2.0);
    }
}

// ai_run_slide: Strafe sideways while facing enemy (ai.qc)
function aiRunSlide(monster, game) {
    const def = monster.data.monsterDef;
    faceEntity(monster, monster.enemy);

    // Calculate strafe direction perpendicular to facing
    const yawRad = monster.data.idealYaw * Math.PI / 180;
    const forwardX = Math.cos(yawRad);
    const forwardY = Math.sin(yawRad);

    // Perpendicular: rotate 90 degrees based on lefty flag
    const strafeDir = monster.data.lefty ? 1 : -1;
    const strafeX = -forwardY * strafeDir;
    const strafeY = forwardX * strafeDir;

    const speed = def.speed;
    monster.velocity.x = strafeX * speed;
    monster.velocity.y = strafeY * speed;

    // Check if stuck and flip direction (ai.qc: if walkmove fails, flip lefty)
    if (monster.data.lastPos) {
        const movedX = monster.position.x - monster.data.lastPos.x;
        const movedY = monster.position.y - monster.data.lastPos.y;
        const movedDist = Math.sqrt(movedX * movedX + movedY * movedY);
        const expectedMove = speed * 0.1;
        if (expectedMove > 5 && movedDist < expectedMove * 0.1) {
            monster.data.lefty = !monster.data.lefty;
        }
    }
    monster.data.lastPos = { ...monster.position };
}

/**
 * Check if monster should attack (fight.qc:CheckAttack / CheckAnyAttack)
 * Sets monster.data.attackState rather than immediately entering ATTACK state.
 * The attack state machine in monsterRun() handles the turn-then-attack flow.
 */
function checkMonsterAttack(monster, range, dist, game) {
    const def = monster.data.monsterDef;

    // Monster-specific attack checks
    if (monster.classname === 'monster_army') {
        return checkSoldierAttack(monster, range, dist, game);
    }

    if (monster.classname === 'monster_demon1' || monster.classname === 'monster_dog') {
        return checkLeapAttack(monster, range, dist, game);
    }

    if (monster.classname === 'monster_shambler') {
        return checkShamblerAttack(monster, range, dist, game);
    }

    if (monster.classname === 'monster_ogre') {
        return checkOgreAttack(monster, range, dist, game);
    }

    // Generic CheckAttack (fight.qc)
    const hasMelee = def.attackType === 'melee' || def.attackType2 === 'melee' ||
                     def.attackType2 === 'chainsaw' || def.meleeDamageMultiplier;

    // Melee attack if in melee range
    if (range === RANGE_MELEE && hasMelee) {
        monster.data.attackState = 'melee';
        return true;
    }

    // No ranged attack available
    if (def.attackType === 'melee' && !def.attackType2) {
        return false;
    }

    // Don't attack if too far
    if (range === RANGE_FAR) {
        return false;
    }

    // Clear shot check (fight.qc: traceline before ranged attack)
    if (!hasClearShot(monster, game)) {
        return false;
    }

    // Calculate attack chance based on range (fight.qc:CheckAttack)
    let chance;
    if (range === RANGE_MELEE) {
        chance = 0.9;
    } else if (range === RANGE_NEAR) {
        chance = hasMelee ? 0.2 : 0.4;
    } else if (range === RANGE_MID) {
        chance = hasMelee ? 0.05 : 0.1;
    } else {
        chance = 0;
    }

    if (Math.random() < chance) {
        monster.data.attackState = 'missile';
        monster.data.attackType = def.attackType === 'melee' ? def.attackType2 : def.attackType;
        monster.data.attackTime = game.time + 0.5;
        // SUB_AttackFinished: random delay before next attack
        monster.data.attackFinished = game.time + 2 * Math.random();
        return true;
    }

    return false;
}

// Soldier-specific attack check (fight.qc:SoldierCheckAttack)
function checkSoldierAttack(monster, range, dist, game) {
    // No melee - soldier only has hitscan
    if (range === RANGE_FAR) return false;

    // Clear shot check
    if (!hasClearShot(monster, game)) return false;

    // Soldier chance values (fight.qc:SoldierCheckAttack - no melee factor)
    let chance;
    if (range === RANGE_MELEE) {
        chance = 0.9;
    } else if (range === RANGE_NEAR) {
        chance = 0.4;
    } else if (range === RANGE_MID) {
        chance = 0.05;
    } else {
        chance = 0;
    }

    if (Math.random() < chance) {
        monster.data.attackState = 'missile';
        monster.data.attackType = 'hitscan';
        monster.data.attackTime = game.time + 0.5;
        // Soldier cooldown: 1 + random() (fight.qc), not 2*random()
        monster.data.attackFinished = game.time + 1 + Math.random();
        // 30% chance to flip strafe direction after deciding to fire
        if (Math.random() < 0.3) {
            monster.data.lefty = !monster.data.lefty;
        }
        return true;
    }

    return false;
}

// Demon/Dog leap attack check (demon.qc:DemonCheckAttack, dog.qc:DogCheckAttack)
function checkLeapAttack(monster, range, dist, game) {
    const def = monster.data.monsterDef;

    // Melee if in range (demon.qc: if enemy_range == RANGE_MELEE → AS_MELEE)
    if (range === RANGE_MELEE) {
        monster.data.attackState = 'melee';
        return true;
    }

    // Must be visible for leap
    if (!monster.data.enemyVisible) return false;

    // Must be facing ideal direction (demon.qc: CheckDemonJump requires FacingIdeal)
    if (!facingIdeal(monster)) return false;

    // Check leap conditions
    const leapRange = def.leapRange || { min: 100, max: 200 };

    // Height check - can only leap if roughly same height
    const enemy = monster.enemy;
    const monsterBottom = monster.position.z + (def.size?.mins?.z || -24);
    const monsterTop = monster.position.z + (def.size?.maxs?.z || 64);
    const enemyBottom = enemy.position.z - 24;
    const enemyTop = enemy.position.z + 32;

    // Must be within 75% and 25% of enemy height (demon.qc:CheckDemonJump)
    if (monsterBottom > enemyBottom + 0.75 * (enemyTop - enemyBottom)) return false;
    if (monsterTop < enemyBottom + 0.25 * (enemyTop - enemyBottom)) return false;

    // Distance check
    const horizDist = Math.sqrt(
        Math.pow(enemy.position.x - monster.position.x, 2) +
        Math.pow(enemy.position.y - monster.position.y, 2)
    );

    if (horizDist < leapRange.min) return false;

    // Dog has strict max range, Demon has probability falloff
    if (monster.classname === 'monster_dog') {
        if (horizDist > leapRange.max) return false;
    } else {
        // Demon: if d > 200, 90% chance to skip
        if (horizDist > leapRange.max && Math.random() < 0.9) return false;
    }

    // Initiate leap directly (leap bypasses the turn-then-attack since we checked FacingIdeal)
    monster.state = MONSTER_STATE.ATTACK;
    monster.data.attackType = 'leap';
    monster.data.attackTime = game.time + 0.2;  // Short windup
    monster.data.attackState = 'straight';

    // Play leap sound
    if (def.leapSound && game.audio) {
        game.audio.playPositioned(`sound/${def.leapSound}`, monster.position);
    }

    return true;
}

// Shambler attack check (fight.qc:ShamCheckAttack)
function checkShamblerAttack(monster, range, dist, game) {
    const def = monster.data.monsterDef;

    // Melee if in range (shambler.qc: AS_MELEE, actual melee type chosen in sham_melee)
    if (range === RANGE_MELEE) {
        monster.data.attackState = 'melee';
        return true;
    }

    // Lightning attack - max range 600
    if (dist > (def.lightningRange || 600)) return false;
    if (range === RANGE_FAR) return false;

    // Clear shot check
    if (!hasClearShot(monster, game)) return false;

    // Lightning attack via missile state (turn then fire)
    monster.data.attackState = 'missile';
    monster.data.attackType = 'lightning';
    monster.data.attackTime = game.time + 0.5;
    monster.data.attackFinished = game.time + 2 + 2 * Math.random();
    return true;
}

// Ogre attack check (fight.qc:OgreCheckAttack)
function checkOgreAttack(monster, range, dist, game) {
    const def = monster.data.monsterDef;

    // Chainsaw melee if in range (ogre.qc: AS_MELEE, choice in ogre_melee)
    if (range === RANGE_MELEE) {
        monster.data.attackState = 'melee';
        return true;
    }

    if (range === RANGE_FAR) return false;

    // Clear shot check
    if (!hasClearShot(monster, game)) return false;

    // Grenade attack
    let chance;
    if (range === RANGE_NEAR) {
        chance = 0.10;
    } else if (range === RANGE_MID) {
        chance = 0.05;
    } else {
        chance = 0;
    }

    if (Math.random() < chance) {
        monster.data.attackState = 'missile';
        monster.data.attackType = 'grenade';
        monster.data.attackTime = game.time + 0.5;
        monster.data.attackFinished = game.time + 1 + 2 * Math.random();
        return true;
    }

    return false;
}

function monsterAttack(monster, game) {
    const def = monster.data.monsterDef;

    // Resolve melee attack subtype per monster when entering attack
    if (monster.data.attackType === 'melee' && !monster.data.meleeResolved) {
        monster.data.meleeResolved = true;
        if (monster.classname === 'monster_shambler') {
            // shambler.qc:sham_melee - random choice
            if (Math.random() > 0.5) {
                monster.data.attackType = 'smash';
            } else if (Math.random() > 0.5) {
                monster.data.attackType = 'claw_right';
            } else {
                monster.data.attackType = 'claw_left';
            }
        } else if (monster.classname === 'monster_ogre') {
            // ogre.qc:ogre_melee - 50/50 smash or swing
            monster.data.attackType = Math.random() > 0.5 ? 'chainsaw_smash' : 'chainsaw_swing';
        } else if (monster.classname === 'monster_knight') {
            // knight.qc:knight_attack - distance check (Fix 9)
            const dist = distanceTo(monster, monster.enemy);
            if (dist >= 80) {
                monster.data.attackType = 'knight_charge';
            }
            // else stays as 'melee' (standing slash)
        }
    }

    if (game.time >= monster.data.attackTime) {
        // Execute attack
        executeAttack(monster, game);
        monster.data.meleeResolved = false;

        // Check if still attacking (multi-part attacks like shambler lightning)
        // executeAttack may have set a new attackTime to continue the sequence
        if (monster.state === MONSTER_STATE.ATTACK && monster.data.attackTime > game.time) {
            // Stay in attack state for next part of attack sequence
        } else {
            // Return to run state
            monster.state = MONSTER_STATE.RUN;
        }
    }

    // Face enemy during attack
    if (monster.enemy) {
        faceEntity(monster, monster.enemy);
    }
}

function monsterPain(monster, game) {
    if (game.time >= monster.data.painTime) {
        monster.state = MONSTER_STATE.RUN;
    }
}

function executeAttack(monster, game) {
    if (!monster.enemy) return;

    const def = monster.data.monsterDef;
    const attackType = monster.data.attackType || def.attackType;

    switch (attackType) {
        case 'melee':
            executeMeleeAttack(monster, game);
            break;

        case 'knight_charge':
            // Knight running charge attack (knight.qc:knight_runatk1)
            // Move toward enemy during attack, then deal melee damage
            if (monster.enemy) {
                moveToward(monster, monster.enemy.position, monster.data.monsterDef.speed, game);
            }
            executeMeleeAttack(monster, game);
            break;

        case 'chainsaw_smash':
        case 'chainsaw_swing':
            executeChainsaw(monster, game);
            break;

        case 'smash':
            executeShamblerSmash(monster, game);
            break;

        case 'claw_right':
        case 'claw_left':
            executeShamblerClaw(monster, attackType === 'claw_right' ? 250 : -250, game);
            break;

        case 'leap':
            executeLeapAttack(monster, game);
            break;

        case 'hitscan':
            executeSoldierAttack(monster, game);
            break;

        case 'laser':
            spawnEnforcerLaser(monster, game, def.damage);
            break;

        case 'grenade':
            spawnMonsterGrenade(monster, game, def.damage);
            break;

        case 'ranged':
        case 'projectile':
            spawnMonsterProjectile(monster, game, def.damage);
            break;

        case 'homing':
            spawnMonsterProjectile(monster, game, def.damage);
            break;

        case 'lightning':
            executeShamblerLightning(monster, game);
            break;

        case 'throw':
            spawnZombieGib(monster, game, def.damage);
            break;
    }
}

// Generic melee attack (fight.qc:ai_melee)
function executeMeleeAttack(monster, game) {
    const def = monster.data.monsterDef;
    const enemy = monster.enemy;
    if (!enemy) return;

    const dist = distanceTo(monster, enemy);
    const meleeRange = def.meleeRange || 60;

    if (dist > meleeRange) return;

    // Calculate damage using Quake's formula
    let damage;
    if (def.meleeDamage) {
        // Fixed base + random (demon)
        damage = def.meleeDamage.base + Math.random() * def.meleeDamage.random;
    } else if (monster.classname === 'monster_fish') {
        // Fish uses (random() + random()) * 3 (fish.qc)
        damage = (Math.random() + Math.random()) * (def.meleeDamageMultiplier || 3);
    } else if (def.meleeDamageMultiplier) {
        // (random()+random()+random()) * multiplier
        damage = randomDamage(def.meleeDamageMultiplier);
    } else {
        damage = def.damage || 10;
    }

    game.dealDamage(enemy, Math.floor(damage), monster);

    // Play attack sound
    if (monster.classname === 'monster_knight') {
        // Knight uses random sword sounds
        const sound = Math.random() > 0.5 ? def.swordSound1 : def.swordSound2;
        if (sound && game.audio) {
            game.audio.playPositioned(`sound/${sound}`, monster.position);
        }
    } else if (monster.classname === 'monster_dog' && def.attackSound && game.audio) {
        // Dog bark on attack (dog.qc:dog_atta4)
        game.audio.playPositioned(`sound/${def.attackSound}`, monster.position);
    } else if (def.hitSound && game.audio) {
        game.audio.playPositioned(`sound/${def.hitSound}`, monster.position);
    } else if (def.attackSound && game.audio) {
        game.audio.playPositioned(`sound/${def.attackSound}`, monster.position);
    }
}

// Ogre chainsaw attack (ogre.qc:chainsaw)
function executeChainsaw(monster, game) {
    const def = monster.data.monsterDef;
    const enemy = monster.enemy;
    if (!enemy) return;

    const dist = distanceTo(monster, enemy);
    if (dist > (def.meleeRange || 100)) return;

    // (random()+random()+random()) * 4
    const damage = randomDamage(def.meleeDamageMultiplier || 4);
    game.dealDamage(enemy, Math.floor(damage), monster);

    // Spawn meat spray
    if (game.effects) {
        game.effects.spawnMeatSpray(monster.position);
    }

    // Play chainsaw sound
    if (def.sawSound && game.audio) {
        game.audio.playPositioned(`sound/${def.sawSound}`, monster.position);
    }
}

// Shambler smash attack (shambler.qc:sham_smash10)
function executeShamblerSmash(monster, game) {
    const def = monster.data.monsterDef;
    const enemy = monster.enemy;
    if (!enemy) return;

    const dist = distanceTo(monster, enemy);
    if (dist > (def.meleeRange || 100)) return;

    // (random()+random()+random()) * 40
    const damage = randomDamage(def.smashDamageMultiplier || 40);
    game.dealDamage(enemy, Math.floor(damage), monster);

    // Play smack sound
    if (def.smackSound && game.audio) {
        game.audio.playPositioned(`sound/${def.smackSound}`, monster.position);
    }

    // Spawn 2 meat sprays
    if (game.effects) {
        game.effects.spawnMeatSpray(monster.position);
        game.effects.spawnMeatSpray(monster.position);
    }
}

// Shambler claw attack (shambler.qc:ShamClaw)
function executeShamblerClaw(monster, side, game) {
    const def = monster.data.monsterDef;
    const enemy = monster.enemy;
    if (!enemy) return;

    const dist = distanceTo(monster, enemy);
    if (dist > (def.meleeRange || 100)) return;

    // (random()+random()+random()) * 20
    const damage = randomDamage(def.clawDamageMultiplier || 20);
    game.dealDamage(enemy, Math.floor(damage), monster);

    // Play smack sound
    if (def.smackSound && game.audio) {
        game.audio.playPositioned(`sound/${def.smackSound}`, monster.position);
    }

    // Spawn meat spray to side
    if (game.effects && side) {
        game.effects.spawnMeatSpray(monster.position);
    }
}

// Leap attack execution (demon.qc, dog.qc)
function executeLeapAttack(monster, game) {
    const def = monster.data.monsterDef;
    const enemy = monster.enemy;
    if (!enemy) return;

    const dx = enemy.position.x - monster.position.x;
    const dy = enemy.position.y - monster.position.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > 0) {
        const leapVel = def.leapVelocity || { forward: 600, up: 250 };

        monster.velocity.x = (dx / dist) * leapVel.forward;
        monster.velocity.y = (dy / dist) * leapVel.forward;
        monster.velocity.z = leapVel.up;
        monster.position.z += 1;  // Raise off floor

        // Calculate leap damage
        const leapDmg = def.leapDamage || { base: 40, random: 10, minVelocity: 400 };
        monster.data.leapDamageBase = leapDmg.base;
        monster.data.leapDamageRandom = leapDmg.random;
        monster.data.leapMinVelocity = leapDmg.minVelocity;
        monster.data.leaping = true;
        monster.onGround = false;
    }
}

// Soldier attack with traced bullets (soldier.qc:army_fire → W_FireShotgun logic)
// Original: FireBullets(4, dir, '0.1 0.1 0') — 4 bullets, 0.1 spread, 4 damage each
function executeSoldierAttack(monster, game) {
    const def = monster.data.monsterDef;
    const enemy = monster.enemy;
    if (!enemy) return;

    const startZ = monster.position.z + (def.viewHeight || 25);
    const start = { x: monster.position.x, y: monster.position.y, z: startZ };

    // Direction to enemy center mass
    const targetX = enemy.position.x;
    const targetY = enemy.position.y;
    const targetZ = enemy.position.z + 22;

    const dirX = targetX - start.x;
    const dirY = targetY - start.y;
    const dirZ = targetZ - start.z;
    const dirLen = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ);

    if (dirLen === 0) return;

    // Normalize fire direction
    const fwdX = dirX / dirLen;
    const fwdY = dirY / dirLen;
    const fwdZ = dirZ / dirLen;

    // Compute right and up vectors from fire direction
    // Simple cross product: right = forward × world_up, up = right × forward
    const upWorldZ = 1;
    let rightX = fwdY * upWorldZ;
    let rightY = -fwdX * upWorldZ;
    let rightZ = 0;
    const rightLen = Math.sqrt(rightX * rightX + rightY * rightY + rightZ * rightZ);
    if (rightLen > 0) {
        rightX /= rightLen;
        rightY /= rightLen;
        rightZ /= rightLen;
    }
    // Up = right × forward
    const upX = rightY * fwdZ - rightZ * fwdY;
    const upY = rightZ * fwdX - rightX * fwdZ;
    const upZ = rightX * fwdY - rightY * fwdX;

    // Fire 4 bullets with crandom()*0.1 spread on right and up axes
    const bulletCount = 4;
    const bulletDamage = 4; // 4 damage per bullet (original Quake)
    for (let i = 0; i < bulletCount; i++) {
        const spreadRight = (Math.random() * 2 - 1) * 0.1;
        const spreadUp = (Math.random() * 2 - 1) * 0.1;

        const shotDirX = fwdX + rightX * spreadRight + upX * spreadUp;
        const shotDirY = fwdY + rightY * spreadRight + upY * spreadUp;
        const shotDirZ = fwdZ + rightZ * spreadRight + upZ * spreadUp;

        // Trace each bullet individually (2048 range like original)
        const endPoint = {
            x: start.x + shotDirX * 2048,
            y: start.y + shotDirY * 2048,
            z: start.z + shotDirZ * 2048
        };

        const trace = game.physics.traceLine(start, endPoint);

        if (trace.entity && trace.entity.health !== undefined) {
            game.dealDamage(trace.entity, bulletDamage, monster);
        }

        // Impact effect at hit point
        if (trace.fraction < 1.0 && game.effects) {
            const hitPos = {
                x: start.x + (endPoint.x - start.x) * trace.fraction,
                y: start.y + (endPoint.y - start.y) * trace.fraction,
                z: start.z + (endPoint.z - start.z) * trace.fraction
            };
            game.effects.impact(hitPos, trace?.plane?.normal, 2);
        }
    }

    // Play shot sound
    if (game.audio) {
        game.audio.playPositioned('sound/soldier/sattck1.wav', monster.position);
    }
}

// Shambler lightning attack (shambler.qc:CastLightning)
function executeShamblerLightning(monster, game) {
    const def = monster.data.monsterDef;
    const enemy = monster.enemy;
    if (!enemy) return;

    // Initialize lightning attack state
    if (!monster.data.lightningBolts) {
        monster.data.lightningBolts = 0;
        // Play start sound
        if (def.attackSound && game.audio) {
            game.audio.playPositioned(`sound/${def.attackSound}`, monster.position);
        }
    }

    monster.data.lightningBolts++;

    // Cast bolt
    const startZ = monster.position.z + 40;  // '0 0 40' in shambler.qc
    const start = { x: monster.position.x, y: monster.position.y, z: startZ };
    const end = {
        x: enemy.position.x,
        y: enemy.position.y,
        z: enemy.position.z + 16
    };

    // Trace for max 600 units
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dz = end.z - start.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (dist > (def.lightningRange || 600)) {
        // Clamp to max range
        const scale = (def.lightningRange || 600) / dist;
        end.x = start.x + dx * scale;
        end.y = start.y + dy * scale;
        end.z = start.z + dz * scale;
    }

    const trace = game.physics.traceLine(start, end);

    // Deal damage if hit enemy
    if (trace.fraction === 1.0 || trace.entity === enemy) {
        game.dealDamage(enemy, def.lightningDamage || 10, monster);
    }

    // Spawn lightning beam visual
    if (game.effects) {
        game.effects.lightningBeam(start, trace.endpos || end);
    }

    // Play boom sound on first bolt
    if (monster.data.lightningBolts === 1 && def.boomSound && game.audio) {
        game.audio.playPositioned(`sound/${def.boomSound}`, monster.position);
    }

    // Shambler fires 3 bolts, or 4 on Nightmare (skill 3)
    const maxBolts = (game.skill === 3) ? 4 : 3;
    if (monster.data.lightningBolts < maxBolts) {
        // Continue lightning attack
        monster.data.attackTime = game.time + 0.1;
    } else {
        // Done with lightning
        monster.data.lightningBolts = 0;
        monster.state = MONSTER_STATE.RUN;
    }
}

function findEnemy(monster, game) {
    // Check if another monster recently saw the player (sight entity propagation)
    // ai.qc: if (sight_entity_time >= time - 0.1 && ...)
    // Fix 7: sight_entity is the MONSTER that spotted the player, not the player itself
    if (game.sightEntity && game.sightEntityTime &&
        game.time - game.sightEntityTime < 0.5) {
        const alertingMonster = game.sightEntity;
        if (alertingMonster && alertingMonster !== monster &&
            alertingMonster.enemy && alertingMonster.enemy.health > 0) {
            // Check if we can see the alerting monster (not the player directly)
            const dist = distanceTo(monster, alertingMonster);
            if (dist < 1000 && canSeeEntity(monster, alertingMonster, game, true)) {
                // We see the alerted monster — target its enemy (the player)
                monster.enemy = alertingMonster.enemy;
                return true;
            }
        }
    }

    // Look for players directly
    for (const player of game.entities.players) {
        if (player.health <= 0) continue;

        // Check invisibility (items.qc: IT_INVISIBILITY)
        if (player.items && (player.items & 0x80000)) continue;  // IT_INVISIBILITY = 524288

        // Range-dependent detection rules (ai.qc:FindTarget)
        const dist = distanceTo(monster, player);
        const range = getRange(dist);

        // FAR range: never detected
        if (range === RANGE_FAR) continue;

        // Check visibility (line of sight)
        if (!canSeeEntityLOS(monster, player, game)) continue;

        // Range-dependent infront requirements
        if (range === RANGE_MELEE) {
            // MELEE: always detected (even behind monster)
            // No angle check needed
        } else if (range === RANGE_NEAR) {
            // NEAR: must be infront OR show_hostile > time
            const infront = isInFront(monster, player);
            const showHostile = game.showHostileTime && game.showHostileTime > game.time;
            if (!infront && !showHostile) continue;
        } else if (range === RANGE_MID) {
            // MID: must be infront
            if (!isInFront(monster, player)) continue;
        }

        monster.enemy = player;

        // Set sight entity for other monsters — store the MONSTER, not the player
        game.sightEntity = monster;
        game.sightEntityTime = game.time;

        return true;
    }

    return false;
}

// Line of sight check only (no angle check) — split from canSeeEntity for findEnemy
function canSeeEntityLOS(monster, target, game) {
    const def = monster.data?.monsterDef;
    const viewHeight = def?.viewHeight || 25;

    const distSq = Math.pow(target.position.x - monster.position.x, 2) +
                   Math.pow(target.position.y - monster.position.y, 2) +
                   Math.pow((target.position.z + 22) - (monster.position.z + viewHeight), 2);

    if (distSq > 1000 * 1000) return false;

    const start = {
        x: monster.position.x,
        y: monster.position.y,
        z: monster.position.z + viewHeight
    };
    const end = {
        x: target.position.x,
        y: target.position.y,
        z: target.position.z + 22
    };

    const trace = game.physics.traceLine(start, end);
    if (trace.startSolid || trace.allSolid) return false;
    return trace.fraction === 1.0;
}

// Check if target is in front of monster (ai.qc:infront — dot > 0.3)
function isInFront(monster, target) {
    const dx = target.position.x - monster.position.x;
    const dy = target.position.y - monster.position.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= 0) return true;

    const yawRad = monster.angles.yaw * Math.PI / 180;
    const forwardX = Math.cos(yawRad);
    const forwardY = Math.sin(yawRad);
    const dot = forwardX * (dx / dist) + forwardY * (dy / dist);
    return dot > 0.3;
}

/**
 * Alert nearby monsters to player's presence (hearing system)
 * Called when player fires a weapon or makes loud noise
 * Original Quake: ai.qc T_MakeNoise and alertSoundEntity
 *
 * @param {Object} game - Game instance
 * @param {Object} position - Position of the noise
 * @param {Object} target - Entity that made the noise (usually player)
 * @param {number} range - How far the sound travels (default 1000 units)
 */
export function alertNearbyMonsters(game, position, target, range = 1000) {
    if (!game.entities || !game.entities.monsters) return;

    for (const monster of game.entities.monsters) {
        if (!monster.active || monster.health <= 0) continue;

        // Already has this target as enemy
        if (monster.enemy === target) continue;

        // Check distance
        const dx = monster.position.x - position.x;
        const dy = monster.position.y - position.y;
        const dz = monster.position.z - position.z;
        const distSq = dx * dx + dy * dy + dz * dz;

        if (distSq > range * range) continue;

        // In original Quake, sound can travel through open areas but not thick walls
        // Simplified: do a line trace to check if there's a clear path
        // If not direct LOS, allow sound to travel if within shorter range (500 units)
        const trace = game.physics.traceLine(
            { x: monster.position.x, y: monster.position.y, z: monster.position.z + 32 },
            { x: position.x, y: position.y, z: position.z + 32 }
        );

        const dist = Math.sqrt(distSq);

        // Direct line of sound or close enough that sound can travel around corners
        if (trace.fraction === 1.0 || dist < 500) {
            // Monster hears the noise and becomes alert
            monster.enemy = target;
            monster.data.lastSightTime = game.time;

            // Only switch to RUN if currently idle (STAND or WALK)
            if (monster.state === MONSTER_STATE.STAND || monster.state === MONSTER_STATE.WALK) {
                foundTarget(monster, game);
            }
        }
    }
}

/**
 * Check if monster can see target (ai.qc:visible and infront)
 * @param {Object} monster - Monster entity
 * @param {Object} target - Target entity
 * @param {Object} game - Game instance
 * @param {boolean} checkAngle - Whether to check FOV (false when already in combat)
 */
function canSeeEntity(monster, target, game, checkAngle = true) {
    const def = monster.data?.monsterDef;
    const viewHeight = def?.viewHeight || 25;

    // Calculate view positions (ai.qc: spot1 = self.origin + self.view_ofs)
    const dx = target.position.x - monster.position.x;
    const dy = target.position.y - monster.position.y;
    const dz = (target.position.z + 22) - (monster.position.z + viewHeight);
    const distSq = dx * dx + dy * dy + dz * dz;

    // Max sight range 1000 units (RANGE_FAR)
    if (distSq > 1000 * 1000) {
        return false;
    }

    // Check angle of sight (ai.qc:infront - dot > 0.3, about 72 degrees each side)
    // Skip angle check if monster already has this enemy
    if (checkAngle && monster.enemy !== target) {
        const yawRad = monster.angles.yaw * Math.PI / 180;
        const forwardX = Math.cos(yawRad);
        const forwardY = Math.sin(yawRad);

        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 0) {
            const toTargetX = dx / dist;
            const toTargetY = dy / dist;
            const dot = forwardX * toTargetX + forwardY * toTargetY;

            // ai.qc:infront - if (dot > 0.3) return TRUE
            if (dot < 0.3) {
                return false;
            }
        }
    }

    // Line of sight check - trace from eye to eye
    const start = {
        x: monster.position.x,
        y: monster.position.y,
        z: monster.position.z + viewHeight
    };

    const end = {
        x: target.position.x,
        y: target.position.y,
        z: target.position.z + 22
    };

    const trace = game.physics.traceLine(start, end);

    // ai.qc:visible - if (trace_inopen && trace_inwater) return FALSE
    // This prevents seeing through water surfaces - simplified check
    if (trace.startSolid || trace.allSolid) {
        return false;
    }

    return trace.fraction === 1.0;
}

// ============================================================================
// sv_move.c port — trace-based monster movement with 8-direction pathfinding
// ============================================================================

const STEPSIZE = 18;
const DI_NODIR = -1;

/**
 * SV_CheckBottom — Returns false if any part of the bottom of the entity
 * is off an edge that is not a staircase.
 */
function checkBottom(monster, game) {
    const hull = monster.hull;
    const mins = {
        x: monster.position.x + hull.mins.x,
        y: monster.position.y + hull.mins.y,
        z: monster.position.z + hull.mins.z
    };
    const maxs = {
        x: monster.position.x + hull.maxs.x,
        y: monster.position.y + hull.maxs.y,
        z: monster.position.z + hull.maxs.z
    };

    // If all corners are over solid ground, pass quickly
    const checkZ = mins.z - 1;
    for (let x = 0; x <= 1; x++) {
        for (let y = 0; y <= 1; y++) {
            const point = {
                x: x ? maxs.x : mins.x,
                y: y ? maxs.y : mins.y,
                z: checkZ
            };
            if (game.physics.pointContents(point) !== -2) { // CONTENTS_SOLID = -2
                // Need real check
                return checkBottomReal(mins, maxs, monster, game);
            }
        }
    }
    return true; // All corners solid
}

function checkBottomReal(mins, maxs, monster, game) {
    // Midpoint must be within 2*STEPSIZE of bottom
    const midX = (mins.x + maxs.x) * 0.5;
    const midY = (mins.y + maxs.y) * 0.5;
    const start = { x: midX, y: midY, z: mins.z };
    const stop = { x: midX, y: midY, z: mins.z - 2 * STEPSIZE };

    // C uses SV_Move(start, vec3_origin, vec3_origin, stop, ...) — point hull
    const trace = game.physics.traceLine(start, stop);
    if (trace.fraction === 1.0) return false;

    const mid = trace.endpos.z;

    // Corners must be within STEPSIZE of the midpoint height
    for (let x = 0; x <= 1; x++) {
        for (let y = 0; y <= 1; y++) {
            const sx = x ? maxs.x : mins.x;
            const sy = y ? maxs.y : mins.y;
            const cStart = { x: sx, y: sy, z: mins.z };
            const cStop = { x: sx, y: sy, z: mins.z - 2 * STEPSIZE };

            const cTrace = game.physics.traceLine(cStart, cStop);
            if (cTrace.fraction === 1.0 || mid - cTrace.endpos.z > STEPSIZE) {
                return false;
            }
        }
    }
    return true;
}

/**
 * SV_movestep — Core movement validation.
 * Tries to move monster by (moveX, moveY). Returns true if move succeeded.
 * Directly updates monster.position on success.
 */
function monsterMoveStep(monster, moveX, moveY, game) {
    const def = monster.data.monsterDef;
    const hull = monster.hull;
    const oldOrigin = { ...monster.position };

    const newOrg = {
        x: monster.position.x + moveX,
        y: monster.position.y + moveY,
        z: monster.position.z
    };

    // Flying/swimming monsters
    if (def.flying || def.swimming) {
        for (let i = 0; i < 2; i++) {
            const tryPos = {
                x: monster.position.x + moveX,
                y: monster.position.y + moveY,
                z: monster.position.z
            };

            // First attempt: adjust Z toward enemy
            if (i === 0 && monster.enemy) {
                const dz = monster.position.z - monster.enemy.position.z;
                if (dz > 40) tryPos.z -= 8;
                if (dz < 30) tryPos.z += 8;
            }

            const trace = game.physics.traceLine(monster.position, tryPos, hull);
            if (trace.fraction === 1.0) {
                // Swimming monster must stay in water
                if (def.swimming) {
                    const contents = game.physics.pointContents(trace.endpos);
                    if (contents === -1) { // CONTENTS_EMPTY
                        return false; // Would leave water
                    }
                }
                monster.position.x = trace.endpos.x;
                monster.position.y = trace.endpos.y;
                monster.position.z = trace.endpos.z;
                return true;
            }

            // Only retry without Z adjust if we have an enemy
            if (!monster.enemy) break;
        }
        return false;
    }

    // Ground monsters: push down from step height above wished position
    newOrg.z += STEPSIZE;
    const end = { x: newOrg.x, y: newOrg.y, z: newOrg.z - STEPSIZE * 2 };

    let trace = game.physics.traceLine(newOrg, end, hull);

    if (trace.allsolid) return false;

    if (trace.startsolid) {
        // Try without the step-up
        newOrg.z -= STEPSIZE;
        trace = game.physics.traceLine(newOrg, end, hull);
        if (trace.allsolid || trace.startsolid) return false;
    }

    if (trace.fraction === 1.0) {
        // Walked off an edge
        if (monster.data.flags & 1) { // FL_PARTIALGROUND
            // Monster had floor pulled out, let it fall
            monster.position.x += moveX;
            monster.position.y += moveY;
            monster.onGround = false;
            return true;
        }
        return false;
    }

    // Move to trace end position
    monster.position.x = trace.endpos.x;
    monster.position.y = trace.endpos.y;
    monster.position.z = trace.endpos.z;

    // Check for dangling corners
    if (!checkBottom(monster, game)) {
        if (monster.data.flags & 1) { // FL_PARTIALGROUND
            return true;
        }
        // Revert
        monster.position.x = oldOrigin.x;
        monster.position.y = oldOrigin.y;
        monster.position.z = oldOrigin.z;
        return false;
    }

    // Clear partial ground flag if set
    if (monster.data.flags & 1) {
        monster.data.flags &= ~1;
    }
    monster.onGround = true;
    monster.groundEntity = trace.entity || null; // SV_movestep: ent->v.groundentity = EDICT_TO_PROG(trace.ent)

    return true;
}

/**
 * SV_StepDirection — Turns to the movement direction, and walks the
 * current distance if facing it.
 */
function stepDirection(monster, yaw, dist, game) {
    monster.data.idealYaw = yaw;
    changeYaw(monster);

    const yawRad = yaw * Math.PI / 180;
    const moveX = Math.cos(yawRad) * dist;
    const moveY = Math.sin(yawRad) * dist;

    const oldOrigin = { ...monster.position };
    if (monsterMoveStep(monster, moveX, moveY, game)) {
        const delta = anglemod(monster.angles.yaw - monster.data.idealYaw);
        if (delta > 45 && delta < 315) {
            // Not turned far enough, revert position
            monster.position.x = oldOrigin.x;
            monster.position.y = oldOrigin.y;
            monster.position.z = oldOrigin.z;
        }
        return true;
    }
    return false;
}

/**
 * SV_NewChaseDir — 8-direction fallback pathfinding.
 * Tries diagonal, axis-aligned, old direction, then sweeps all 8 directions.
 */
function newChaseDir(monster, enemyPos, dist, game) {
    const olddir = anglemod(Math.floor(monster.data.idealYaw / 45) * 45);
    const turnaround = anglemod(olddir - 180);

    const deltax = enemyPos.x - monster.position.x;
    const deltay = enemyPos.y - monster.position.y;

    const d = [0, 0, 0];
    if (deltax > 10) d[1] = 0;
    else if (deltax < -10) d[1] = 180;
    else d[1] = DI_NODIR;

    if (deltay < -10) d[2] = 270;
    else if (deltay > 10) d[2] = 90;
    else d[2] = DI_NODIR;

    // Try direct route (diagonal)
    if (d[1] !== DI_NODIR && d[2] !== DI_NODIR) {
        let tdir;
        if (d[1] === 0) tdir = d[2] === 90 ? 45 : 315;
        else tdir = d[2] === 90 ? 135 : 225;

        if (tdir !== turnaround && stepDirection(monster, tdir, dist, game)) return;
    }

    // Randomly swap X/Y priority
    // C: ((rand()&3) & 1) — true when lowest 2 bits are both 1, i.e. 25% chance
    if (((Math.random() * 4 | 0) === 1) || Math.abs(deltay) > Math.abs(deltax)) {
        const tmp = d[1];
        d[1] = d[2];
        d[2] = tmp;
    }

    if (d[1] !== DI_NODIR && d[1] !== turnaround &&
        stepDirection(monster, d[1], dist, game)) return;

    if (d[2] !== DI_NODIR && d[2] !== turnaround &&
        stepDirection(monster, d[2], dist, game)) return;

    // No direct path — try old direction
    if (olddir !== DI_NODIR && stepDirection(monster, olddir, dist, game)) return;

    // Sweep all 8 directions (randomly CW or CCW)
    if (Math.random() < 0.5) {
        for (let tdir = 0; tdir <= 315; tdir += 45) {
            if (tdir !== turnaround && stepDirection(monster, tdir, dist, game)) return;
        }
    } else {
        for (let tdir = 315; tdir >= 0; tdir -= 45) {
            if (tdir !== turnaround && stepDirection(monster, tdir, dist, game)) return;
        }
    }

    // Last resort: turnaround
    if (turnaround !== DI_NODIR && stepDirection(monster, turnaround, dist, game)) return;

    // Can't move at all
    monster.data.idealYaw = olddir;

    if (!checkBottom(monster, game)) {
        monster.data.flags = (monster.data.flags || 0) | 1; // FL_PARTIALGROUND
    }
}

/**
 * SV_CloseEnough — Check if monster is close enough to goal entity.
 */
function closeEnough(monster, goal, dist) {
    if (!goal || !goal.position) return false;
    const hull = monster.hull;
    // absmin/absmax = origin + mins/maxs
    const monMins = {
        x: monster.position.x + hull.mins.x,
        y: monster.position.y + hull.mins.y,
        z: monster.position.z + hull.mins.z
    };
    const monMaxs = {
        x: monster.position.x + hull.maxs.x,
        y: monster.position.y + hull.maxs.y,
        z: monster.position.z + hull.maxs.z
    };

    // Goal bbox — use hull if available, otherwise treat as point
    const gHull = goal.hull || { mins: { x: 0, y: 0, z: 0 }, maxs: { x: 0, y: 0, z: 0 } };
    const goalMins = {
        x: goal.position.x + gHull.mins.x,
        y: goal.position.y + gHull.mins.y,
        z: goal.position.z + gHull.mins.z
    };
    const goalMaxs = {
        x: goal.position.x + gHull.maxs.x,
        y: goal.position.y + gHull.maxs.y,
        z: goal.position.z + gHull.maxs.z
    };

    for (const axis of ['x', 'y', 'z']) {
        if (goalMins[axis] > monMaxs[axis] + dist) return false;
        if (goalMaxs[axis] < monMins[axis] - dist) return false;
    }
    return true;
}

/**
 * SV_MoveToGoal — Entry point for monster movement.
 * Port of SV_MoveToGoal from sv_move.c.
 * dist = speed * 0.1 (distance to move per think interval)
 */
function moveToGoal(monster, dist, game) {
    const def = monster.data.monsterDef;

    // Must be on ground, flying, or swimming
    if (!monster.onGround && !def.flying && !def.swimming) return;

    // Initialize flags if needed
    if (monster.data.flags === undefined) monster.data.flags = 0;

    // If close enough to goal, don't move
    // C: goal = PROG_TO_EDICT(ent->v.goalentity) — uses goalEntity, not enemy
    const goal = monster.goalEntity || monster.enemy;
    if (monster.enemy && goal && closeEnough(monster, goal, dist)) return;

    // Save position before trace-based movement
    const startX = monster.position.x;
    const startY = monster.position.y;
    const startZ = monster.position.z;

    // 25% chance: pick new chase direction (prevents stuck loops)
    // Otherwise: try stepping in current ideal_yaw direction
    if (Math.random() < 0.25 || !stepDirection(monster, monster.data.idealYaw, dist, game)) {
        const enemyPos = goal ? goal.position : monster.position;
        newChaseDir(monster, enemyPos, dist, game);
    }

    // Convert position delta into velocity for smooth physics-driven movement.
    // The traces validated the move and updated position directly — we capture
    // the delta, restore the old position, and set velocity so the physics
    // system moves the monster there smoothly over the think interval (0.1s).
    const dx = monster.position.x - startX;
    const dy = monster.position.y - startY;
    const dz = monster.position.z - startZ;

    monster.position.x = startX;
    monster.position.y = startY;
    monster.position.z = startZ;

    const thinkInterval = 0.1;
    monster.velocity.x = dx / thinkInterval;
    monster.velocity.y = dy / thinkInterval;
    if (dz !== 0) {
        monster.velocity.z = dz / thinkInterval;
    }
}

function moveToward(monster, targetPos, speed, game) {
    const dx = targetPos.x - monster.position.x;
    const dy = targetPos.y - monster.position.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > 0) {
        monster.velocity.x = (dx / dist) * speed;
        monster.velocity.y = (dy / dist) * speed;

        // Face movement direction (gradual via changeYaw)
        monster.data.idealYaw = Math.atan2(dy, dx) * 180 / Math.PI;
    }
}

function faceEntity(monster, target) {
    const dx = target.position.x - monster.position.x;
    const dy = target.position.y - monster.position.y;
    monster.data.idealYaw = Math.atan2(dy, dx) * 180 / Math.PI;
}

// Scrag/Wizard hovering and strafing movement (like original Quake)
function moveWizard(monster, targetPos, speed, game) {
    const dx = targetPos.x - monster.position.x;
    const dy = targetPos.y - monster.position.y;
    const dz = (targetPos.z + 32) - monster.position.z;  // Hover above target height
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 1) return;

    // Initialize strafe state
    if (monster.data.wizardStrafeTime === undefined) {
        monster.data.wizardStrafeTime = game.time;
        monster.data.wizardStrafeDir = Math.random() > 0.5 ? 1 : -1;
    }

    // Change strafe direction periodically
    if (game.time - monster.data.wizardStrafeTime > 0.8) {
        monster.data.wizardStrafeTime = game.time;
        monster.data.wizardStrafeDir *= -1;  // Reverse strafe direction
    }

    // Calculate forward direction
    const forwardX = dx / dist;
    const forwardY = dy / dist;

    // Calculate strafe direction (perpendicular)
    const strafeX = -forwardY * monster.data.wizardStrafeDir;
    const strafeY = forwardX * monster.data.wizardStrafeDir;

    // Combine forward and strafe movement
    // Close = more strafing, far = more forward
    const strafeFactor = dist < 200 ? 0.7 : 0.3;
    const forwardFactor = 1 - strafeFactor;

    const moveX = forwardX * forwardFactor + strafeX * strafeFactor;
    const moveY = forwardY * forwardFactor + strafeY * strafeFactor;

    // Normalize
    const moveLen = Math.sqrt(moveX * moveX + moveY * moveY);

    monster.velocity.x = (moveX / moveLen) * speed;
    monster.velocity.y = (moveY / moveLen) * speed;

    // Vertical hover - try to stay at enemy eye level + some height
    const idealZ = targetPos.z + 48;
    const zDiff = idealZ - monster.position.z;

    // Smooth vertical movement
    monster.velocity.z = Math.max(-100, Math.min(100, zDiff * 2));

    // Add some bob
    const bobPhase = game.time * 3;
    monster.velocity.z += Math.sin(bobPhase) * 20;

    // Face the enemy (gradual via changeYaw)
    monster.data.idealYaw = Math.atan2(dy, dx) * 180 / Math.PI;
}

function distanceTo(monster, target) {
    const dx = target.position.x - monster.position.x;
    const dy = target.position.y - monster.position.y;
    const dz = target.position.z - monster.position.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function monsterTakeDamage(monster, damage, attacker, game) {
    const def = monster.data.monsterDef;

    // Demon is immune to pain during leap (demon.qc:demon1_pain)
    if (monster.data.leaping) {
        return;
    }

    // Reduce explosion damage for shamblers (rockets, grenades)
    if (def.halfDamageFromExplosion && attacker &&
        (attacker.classname === 'rocket' || attacker.classname === 'grenade')) {
        damage *= 0.5;
    }

    // Zombies can only be killed by gibbing (damage that would bring health below -40)
    // Regular damage just causes pain but zombie stays at 1 health
    if (def.gibOnly) {
        const newHealth = monster.health - damage;
        if (newHealth > -40) {
            // Not enough damage to gib - zombie takes pain but doesn't die
            monster.health = Math.max(1, newHealth);
            triggerPainReaction(monster, damage, game);
            return;
        }
        // Gibbing damage - continue to death
    }

    monster.health -= damage;

    // Apply knockback from damage (original Quake does this)
    if (attacker && attacker.position) {
        const dx = monster.position.x - attacker.position.x;
        const dy = monster.position.y - attacker.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 0) {
            const knockback = damage * 8;
            monster.velocity.x += (dx / dist) * knockback;
            monster.velocity.y += (dy / dist) * knockback;
            monster.velocity.z += knockback * 0.5;
        }
    }

    if (monster.health <= 0) {
        monsterDie(monster, attacker, game);
        return;
    }

    // Pain reaction with per-monster thresholds
    triggerPainReaction(monster, damage, game);

    // Aggro on attacker - supports monster infighting!
    if (attacker && attacker !== monster) {
        if (attacker.classname === 'player') {
            monster.enemy = attacker;
        } else if (attacker.category === 'monster' && attacker.health > 0) {
            // Monster infighting! Save old enemy and switch to attacker
            if (!monster.data.oldenemy) {
                monster.data.oldenemy = monster.enemy;
            }
            monster.enemy = attacker;
            monster.state = MONSTER_STATE.RUN;
        }
    }
}

/**
 * Trigger pain reaction with proper per-monster thresholds
 * Original Quake pain functions check random()*threshold > damage
 */
function triggerPainReaction(monster, damage, game) {
    const def = monster.data.monsterDef;

    // Check pain cooldown
    if (game.time < (monster.data.painTime || 0)) {
        return;
    }

    // Per-monster pain threshold (shambler.qc: random()*400 > damage, demon.qc: random()*200 > damage)
    if (def.painThreshold) {
        if (Math.random() * def.painThreshold > damage) {
            return;  // Didn't flinch due to insufficient damage
        }
    }

    // Enter pain state
    monster.state = MONSTER_STATE.PAIN;

    // Pain duration varies by monster
    let painDuration = 0.5;

    // Knight has 85% short pain (3 frames), 15% long pain (11 frames)
    if (monster.classname === 'monster_knight') {
        painDuration = Math.random() < 0.85 ? 0.3 : 1.1;
    }
    // Ogre has multiple pain animations
    else if (monster.classname === 'monster_ogre') {
        const r = Math.random();
        if (r < 0.25) painDuration = 0.4;
        else if (r < 0.50) painDuration = 0.5;
        else if (r < 0.75) painDuration = 0.6;
        else if (r < 0.87) painDuration = 0.7;
        else painDuration = 0.8;
    }
    // Soldier has 3 pain levels (20%/60%/100% based on damage)
    else if (monster.classname === 'monster_army') {
        if (Math.random() * 100 < 20) painDuration = 0.2;
        else if (Math.random() * 100 < 60) painDuration = 0.4;
        else painDuration = 0.6;
    }
    // Dog has 50% short, 50% long pain
    else if (monster.classname === 'monster_dog') {
        painDuration = Math.random() > 0.5 ? 0.6 : 1.6;
    }

    monster.data.painTime = game.time + painDuration;

    // Play pain sound (some monsters have multiple)
    if (game.audio) {
        if (def.painSound2 && Math.random() > 0.5) {
            game.audio.playPositioned(`sound/${def.painSound2}`, monster.position);
        } else if (def.painSound) {
            game.audio.playPositioned(`sound/${def.painSound}`, monster.position);
        }
    }
}

function monsterDie(monster, attacker, game) {
    const def = monster.data.monsterDef;

    monster.state = MONSTER_STATE.DIE;
    monster.solid = 'not'; // Corpse doesn't block

    // Increment kill count
    if (game.incrementKills) {
        game.incrementKills();
    }

    // Check for gibbing - use per-monster gib threshold
    // soldier: -35, dog: -35, knight: -40, ogre: -80, demon: -80, shambler: -60, etc.
    const gibThreshold = def.gibThreshold || -40;
    if (monster.health < gibThreshold || def.gibOnly) {
        monsterGib(monster, attacker, game);
        return;
    }

    // Spawn/Tarbaby explodes on death dealing radius damage (tarbaby.qc:tbaby_die)
    if (monster.classname === 'monster_tarbaby') {
        tarbabyExplode(monster, game);
        return;
    }

    // Drop ammo on death (soldier drops shells, ogre drops rockets, etc.)
    if (def.dropAmmo) {
        spawnDroppedAmmo(monster, def.dropAmmo, game);
    }

    // Use TOSS for corpse physics (body falls and bounces like original Quake)
    monster.moveType = 'toss';

    // Add some death velocity/tumble
    if (attacker && attacker.position) {
        const dx = monster.position.x - attacker.position.x;
        const dy = monster.position.y - attacker.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 0) {
            monster.velocity.x = (dx / dist) * 100;
            monster.velocity.y = (dy / dist) * 100;
            monster.velocity.z = 100; // Pop up slightly
        }
    }

    if (def.deathSound && game.audio) {
        game.audio.playPositioned(`sound/${def.deathSound}`, monster.position);
    }

    // Set death animation (don't loop - play once and stop on last frame)
    if (monster.mesh && game.renderer && game.renderer.aliasRenderer) {
        game.renderer.aliasRenderer.setAnimation(monster.mesh, 'death', false);
    }

    // Schedule removal after death animation (30 seconds like original Quake)
    // Corpses stay longer but eventually despawn
    monster.data.removeTime = game.time + 30.0;
    monster.think = (m, g) => {
        if (g.time >= m.data.removeTime) {
            // Remove from scene
            if (m.mesh && g.renderer) {
                g.renderer.removeFromScene(m.mesh);
            }
            // Remove from physics
            if (g.physics) {
                g.physics.removeEntity(m);
            }
            g.entities.remove(m);
        } else {
            m.nextThink = g.time + 1.0; // Slower think for corpses
        }
    };
    monster.nextThink = game.time + 0.1;
}

/**
 * Spawn/Tarbaby explosion on death (tarbaby.qc:tbaby_die)
 * Spawn explodes dealing 40 damage, radius = damage + 40 = 80
 */
function tarbabyExplode(monster, game) {
    const def = monster.data.monsterDef;
    const damage = def.explosionDamage || 40;
    const radius = damage + 40; // Original Quake: radius = damage + 40
    const center = monster.position;

    // Deal splash damage to nearby entities (T_RadiusDamage from combat.qc)
    // Original: points = 0.5 * vlen(org - targ.origin), damage = damage - points
    const checkEntities = [...game.entities.players, ...game.entities.monsters];
    for (const entity of checkEntities) {
        if (!entity.active) continue;

        const dx = entity.position.x - center.x;
        const dy = entity.position.y - center.y;
        const dz = entity.position.z - center.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (dist < radius) {
            const points = 0.5 * dist;
            const splashDamage = Math.floor(damage - points);
            if (splashDamage > 0) {
                game.dealDamage(entity, splashDamage, monster);
            }
        }
    }

    // Spawn explosion effect
    if (game.effects) {
        game.effects.spawnExplosion(center, 1.0);
    }

    // Play death/explosion sound
    if (game.audio) {
        game.audio.playPositioned('sound/blob/death1.wav', center, 1.0, 1.0);
    }

    // Remove monster immediately
    if (monster.mesh && game.renderer) {
        game.renderer.removeFromScene(monster.mesh);
    }
    if (game.physics) {
        game.physics.removeEntity(monster);
    }
    game.entities.remove(monster);
}

/**
 * Monster gib death - called when killed with extreme damage (health < -40)
 * Original: ThrowGib from player.qc
 *
 * Spawns gib models that fly outward with blood trails.
 * Monster is immediately removed and replaced with gibs.
 */
function monsterGib(monster, attacker, game) {
    const def = monster.data.monsterDef;

    // Calculate gib velocity based on overkill damage
    // More overkill = faster gibs
    const overkill = Math.abs(monster.health);
    const velocity = Math.min(600, 200 + overkill * 2);

    // Head gib model mapping (some monsters have specific head models)
    const headGibModels = {
        'monster_army': 'progs/h_guard.mdl',
        'monster_dog': 'progs/h_dog.mdl',
        'monster_ogre': 'progs/h_ogre.mdl',
        'monster_knight': 'progs/h_knight.mdl',
        'monster_demon1': 'progs/h_demon.mdl',
        'monster_wizard': 'progs/h_wizard.mdl',
        'monster_zombie': 'progs/h_zombie.mdl',
        'monster_shambler': 'progs/h_shams.mdl',
        'monster_hell_knight': 'progs/h_hellkn.mdl',
        'monster_enforcer': 'progs/h_mega.mdl',
        'monster_shalrath': 'progs/h_shal.mdl'
    };

    const headModel = headGibModels[monster.classname] || null;

    // Spawn gibs through effects system
    if (game.renderer && game.renderer.effects) {
        game.renderer.effects.spawnGibs(monster.position, velocity, game, headModel);
    }

    // Play gib sound
    if (game.audio) {
        // Zombies have a specific gib sound
        if (def.gibOnly) {
            game.audio.playPositioned('sound/zombie/z_gib.wav', monster.position, 1.0, 1.0);
        } else {
            game.audio.playPositioned('sound/player/udeath.wav', monster.position, 1.0, 1.0);
        }
    }

    // Remove monster model immediately
    if (monster.mesh && game.renderer) {
        game.renderer.removeFromScene(monster.mesh);
    }

    // Remove from physics
    if (game.physics) {
        game.physics.removeEntity(monster);
    }

    // Remove from entity list
    game.entities.remove(monster);
}

/**
 * Monster projectile spawning functions
 */

// Spawn a monster projectile (fireball, magic missile, etc.)
function spawnMonsterProjectile(monster, game, damage) {
    if (!monster.enemy) return;

    const projectile = game.entities.spawn();
    if (!projectile) return;

    // Calculate direction to enemy
    const startZ = monster.position.z + 32; // Eye height
    const targetZ = monster.enemy.position.z + 22; // Target center mass

    const dx = monster.enemy.position.x - monster.position.x;
    const dy = monster.enemy.position.y - monster.position.y;
    const dz = targetZ - startZ;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (dist === 0) return;

    // Normalize and set speed based on monster type
    let speed = 600; // Default projectile speed
    let projectileType = 'fireball';

    if (monster.classname === 'monster_wizard') {
        // Wizard fires two staggered spikes (wizard.qc:Wiz_FastFire)
        game.entities.remove(projectile); // Release unused pre-spawned entity
        spawnWizardProjectiles(monster, game, damage);
        return;
    } else if (monster.classname === 'monster_hell_knight') {
        speed = 300;
        projectileType = 'k_spike'; // Death Knight magic
        game.entities.remove(projectile); // Release unused pre-spawned entity
        // Death Knight fires 6 projectiles in a spread
        spawnHKnightProjectiles(monster, game, damage, speed, projectileType);
        return; // Early return since we spawn multiple
    } else if (monster.classname === 'monster_shalrath') {
        // Vore homing missile (shalrath.qc:ShalMissile)
        speed = (game.skill === 3) ? 350 : 250;
        projectileType = 'v_spike';

        projectile.classname = projectileType;
        projectile.category = 'projectile';
        projectile.moveType = 'fly';
        projectile.solid = 'bbox';
        projectile.hull = {
            mins: { x: -4, y: -4, z: -4 },
            maxs: { x: 4, y: 4, z: 4 }
        };

        // Spawn offset: z+10 (not z+32)
        const voreStartZ = monster.position.z + 10;
        const voreDx = monster.enemy.position.x - monster.position.x;
        const voreDy = monster.enemy.position.y - monster.position.y;
        const voreDz = (monster.enemy.position.z + 22) - voreStartZ;
        const voreDist = Math.sqrt(voreDx * voreDx + voreDy * voreDy + voreDz * voreDz);

        if (voreDist === 0) { game.entities.remove(projectile); return; }

        projectile.position = {
            x: monster.position.x,
            y: monster.position.y,
            z: voreStartZ
        };

        projectile.velocity = {
            x: (voreDx / voreDist) * speed,
            y: (voreDy / voreDist) * speed,
            z: (voreDz / voreDist) * speed
        };

        projectile.data = {
            damage: damage,
            owner: monster,
            target: monster.enemy,
            spawnTime: game.time,
            isHoming: true,
            homingStartTime: game.time + Math.max(0.1, voreDist * 0.002),
            homingSpeed: speed
        };

        // Touch callback — 110 direct damage to zombies, normal damage otherwise
        projectile.touch = (proj, other, g, trace) => {
            if (other && other === proj.data.owner) return;
            if (other && other.health !== undefined) {
                const dmg = (other.classname === 'monster_zombie') ? 110 : proj.data.damage;
                g.dealDamage(other, dmg, proj.data.owner);
            }
            if (g.effects && trace) {
                g.effects.spawnExplosion(proj.position, 0.6);
            }
            g.entities.remove(proj);
            g.physics.removeEntity(proj);
        };

        // Think callback — straight flight then hard-reset homing (shalrath.qc:ShalHome)
        projectile.think = (proj, g) => {
            if (g.time - proj.data.spawnTime > 6.0) {
                if (g.effects) g.effects.spawnExplosion(proj.position, 0.3);
                g.entities.remove(proj);
                g.physics.removeEntity(proj);
                return;
            }

            // Only home after initial straight flight period
            if (g.time >= proj.data.homingStartTime && proj.data.target && proj.data.target.health > 0) {
                const target = proj.data.target;
                const tdx = target.position.x - proj.position.x;
                const tdy = target.position.y - proj.position.y;
                const tdz = (target.position.z + 22) - proj.position.z;
                const tdist = Math.sqrt(tdx * tdx + tdy * tdy + tdz * tdz);

                if (tdist > 0) {
                    // Hard velocity reset toward target (original Quake behavior)
                    const spd = proj.data.homingSpeed;
                    proj.velocity.x = (tdx / tdist) * spd;
                    proj.velocity.y = (tdy / tdist) * spd;
                    proj.velocity.z = (tdz / tdist) * spd;
                }
            }

            proj.nextThink = g.time + 0.2; // 0.2s think interval when homing
        };
        projectile.nextThink = game.time + 0.2;

        game.entities.addToCategory(projectile);
        game.physics.addEntity(projectile);

        if (game.effects) {
            game.effects.attachProjectileTrail(projectile, projectileType);
        }

        // Vore attack sound (shalrath.qc)
        if (game.audio) {
            game.audio.playPositioned('sound/shalrath/attack2.wav', monster.position);
        }
        return;
    }

    projectile.classname = projectileType;
    projectile.category = 'projectile';
    projectile.moveType = 'fly';
    projectile.solid = 'bbox';
    projectile.hull = {
        mins: { x: -4, y: -4, z: -4 },
        maxs: { x: 4, y: 4, z: 4 }
    };

    projectile.position = {
        x: monster.position.x,
        y: monster.position.y,
        z: startZ
    };

    projectile.velocity = {
        x: (dx / dist) * speed,
        y: (dy / dist) * speed,
        z: (dz / dist) * speed
    };

    projectile.data = {
        damage: damage,
        owner: monster,
        spawnTime: game.time
    };

    // Touch callback - damage on hit
    projectile.touch = (proj, other, g, trace) => {
        if (other && other === proj.data.owner) return;
        if (other && other.health !== undefined) {
            g.dealDamage(other, proj.data.damage, proj.data.owner);
        }
        if (g.effects && trace) {
            g.effects.spawnExplosion(proj.position, 0.3);
        }
        g.entities.remove(proj);
        g.physics.removeEntity(proj);
    };

    // Think callback - timeout
    projectile.think = (proj, g) => {
        if (g.time - proj.data.spawnTime > 6.0) {
            if (g.effects) g.effects.spawnExplosion(proj.position, 0.3);
            g.entities.remove(proj);
            g.physics.removeEntity(proj);
            return;
        }
        proj.nextThink = g.time + 0.5;
    };
    projectile.nextThink = game.time + 0.5;

    game.entities.addToCategory(projectile);
    game.physics.addEntity(projectile);

    // Create visual representation
    if (game.effects) {
        game.effects.attachProjectileTrail(projectile, projectileType);
    }

}

// Spawn Wizard/Scrag dual spikes (wizard.qc:Wiz_FastFire)
// Original fires 2 spikes from left/right offsets with a short stagger
function spawnWizardProjectiles(monster, game, damage) {
    if (!monster.enemy) return;

    const speed = 600;
    const projectileType = 'w_spike';

    // Calculate forward and right vectors
    const yawRad = (monster.angles?.yaw || 0) * Math.PI / 180;
    const forwardX = Math.cos(yawRad);
    const forwardY = Math.sin(yawRad);
    const rightX = forwardY;
    const rightY = -forwardX;

    // Spawn offsets: origin + '0 0 30' + forward*14 ± right*14
    const baseZ = monster.position.z + 30;
    const offsets = [
        { x: forwardX * 14 + rightX * 14, y: forwardY * 14 + rightY * 14 },  // Right
        { x: forwardX * 14 - rightX * 14, y: forwardY * 14 - rightY * 14 }   // Left
    ];

    for (let i = 0; i < 2; i++) {
        const off = offsets[i];
        const startX = monster.position.x + off.x;
        const startY = monster.position.y + off.y;
        const startZ = baseZ;

        const targetZ = monster.enemy.position.z + 22;
        const dx = monster.enemy.position.x - startX;
        const dy = monster.enemy.position.y - startY;
        const dz = targetZ - startZ;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (dist === 0) continue;

        // Stagger: second spike fires ~0.3s later via delayed spawn
        const delay = i * 0.3;

        if (delay === 0) {
            spawnSingleWizardSpike(monster, game, damage, speed, projectileType,
                { x: startX, y: startY, z: startZ },
                { x: dx / dist, y: dy / dist, z: dz / dist });
        } else {
            // Schedule delayed spike via a temporary spawned entity
            const capturedStart = { x: startX, y: startY, z: startZ };
            const capturedDir = { x: dx / dist, y: dy / dist, z: dz / dist };
            const capturedMonster = monster;
            const delayEnt = game.entities.spawn();
            if (delayEnt) {
                delayEnt.classname = 'wizard_spike_delay';
                delayEnt.position = { ...monster.position };
                delayEnt.think = (ent, g) => {
                    // Recalculate direction to current enemy position for second spike
                    if (capturedMonster.enemy && capturedMonster.enemy.health > 0) {
                        const newDx = capturedMonster.enemy.position.x - capturedStart.x;
                        const newDy = capturedMonster.enemy.position.y - capturedStart.y;
                        const newDz = (capturedMonster.enemy.position.z + 22) - capturedStart.z;
                        const newDist = Math.sqrt(newDx * newDx + newDy * newDy + newDz * newDz);
                        if (newDist > 0) {
                            capturedDir.x = newDx / newDist;
                            capturedDir.y = newDy / newDist;
                            capturedDir.z = newDz / newDist;
                        }
                    }
                    spawnSingleWizardSpike(capturedMonster, g, damage, speed, projectileType,
                        capturedStart, capturedDir);
                    g.entities.remove(ent);
                };
                delayEnt.nextThink = game.time + delay;
            }
        }
    }

    // Play attack sound
    if (game.audio) {
        game.audio.playPositioned('sound/wizard/wattack.wav', monster.position);
    }
}

function spawnSingleWizardSpike(monster, game, damage, speed, projectileType, start, dir) {
    const projectile = game.entities.spawn();
    if (!projectile) return;

    projectile.classname = projectileType;
    projectile.category = 'projectile';
    projectile.moveType = 'fly';
    projectile.solid = 'bbox';
    projectile.hull = {
        mins: { x: -4, y: -4, z: -4 },
        maxs: { x: 4, y: 4, z: 4 }
    };

    projectile.position = { x: start.x, y: start.y, z: start.z };
    projectile.velocity = {
        x: dir.x * speed,
        y: dir.y * speed,
        z: dir.z * speed
    };

    projectile.data = {
        damage: damage,
        owner: monster,
        spawnTime: game.time
    };

    projectile.touch = (proj, other, g, trace) => {
        if (other && other === proj.data.owner) return;
        if (other && other.health !== undefined) {
            g.dealDamage(other, proj.data.damage, proj.data.owner);
        }
        if (g.effects && trace) {
            g.effects.spawnExplosion(proj.position, 0.3);
        }
        g.entities.remove(proj);
        g.physics.removeEntity(proj);
    };

    projectile.think = (proj, g) => {
        if (g.time - proj.data.spawnTime > 6.0) {
            g.entities.remove(proj);
            g.physics.removeEntity(proj);
        } else {
            proj.nextThink = g.time + 0.5;
        }
    };
    projectile.nextThink = game.time + 0.5;

    game.entities.addToCategory(projectile);
    game.physics.addEntity(projectile);

    if (game.effects) {
        game.effects.attachProjectileTrail(projectile, projectileType);
    }
}

// Spawn Enforcer laser projectile
function spawnEnforcerLaser(monster, game, damage) {
    if (!monster.enemy) return;

    const projectile = game.entities.spawn();
    if (!projectile) return;

    // Calculate forward and right vectors from monster facing direction
    const yawRad = (monster.angles?.yaw || 0) * Math.PI / 180;
    const forwardX = Math.cos(yawRad);
    const forwardY = Math.sin(yawRad);
    const rightX = forwardY;  // perpendicular right
    const rightY = -forwardX;

    // Spawn offset: origin + forward*30 + right*8.5 + '0 0 16' (enforcer.qc)
    const startX = monster.position.x + forwardX * 30 + rightX * 8.5;
    const startY = monster.position.y + forwardY * 30 + rightY * 8.5;
    const startZ = monster.position.z + 16;

    const targetZ = monster.enemy.position.z + 22;

    const dx = monster.enemy.position.x - startX;
    const dy = monster.enemy.position.y - startY;
    const dz = targetZ - startZ;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (dist === 0) return;

    const speed = 600;  // Original Quake enforcer laser speed

    projectile.classname = 'laser';
    projectile.category = 'projectile';
    projectile.moveType = 'fly';
    projectile.solid = 'bbox';
    projectile.hull = {
        mins: { x: -2, y: -2, z: -2 },
        maxs: { x: 2, y: 2, z: 2 }
    };

    projectile.position = {
        x: startX,
        y: startY,
        z: startZ
    };

    projectile.velocity = {
        x: (dx / dist) * speed,
        y: (dy / dist) * speed,
        z: (dz / dist) * speed
    };

    projectile.data = {
        damage: damage,
        owner: monster,
        spawnTime: game.time
    };

    projectile.touch = (proj, other, g, trace) => {
        if (other && other === proj.data.owner) return;
        if (other && other.health !== undefined) {
            g.dealDamage(other, proj.data.damage, proj.data.owner);
        }
        // Laser impact effect
        if (g.effects && trace) {
            g.effects.impact(proj.position, trace?.plane?.normal);
        }
        // Impact sound (enforcer.qc)
        if (g.audio) {
            g.audio.playPositioned('sound/enforcer/enfstop.wav', proj.position);
        }
        g.entities.remove(proj);
        g.physics.removeEntity(proj);
    };

    projectile.think = (proj, g) => {
        if (g.time - proj.data.spawnTime > 5.0) {
            g.entities.remove(proj);
            g.physics.removeEntity(proj);
        } else {
            proj.nextThink = g.time + 0.5;
        }
    };
    projectile.nextThink = game.time + 0.5;

    game.entities.addToCategory(projectile);
    game.physics.addEntity(projectile);

    // Attach laser visual trail (yellow beam)
    if (game.effects) {
        game.effects.attachProjectileTrail(projectile, 'laser');
    }

    // Play laser sound
    if (game.audio) {
        game.audio.playPositioned('sound/enforcer/enfire.wav', monster.position);
    }
}

// Spawn Death Knight spread projectiles — 6 magic missiles (hknight.qc)
// Original fires 6 spikes with yaw offsets [-2,-1,0,1,2,3] * 6 degrees
function spawnHKnightProjectiles(monster, game, damage, speed, projectileType) {
    if (!monster.enemy) return;

    // Spawn offset: origin + bbox center (z+8, not z+32) + forward*20
    const yawRad = (monster.angles?.yaw || 0) * Math.PI / 180;
    const forwardX = Math.cos(yawRad);
    const forwardY = Math.sin(yawRad);
    const startX = monster.position.x + forwardX * 20;
    const startY = monster.position.y + forwardY * 20;
    const startZ = monster.position.z + 8;

    const targetZ = monster.enemy.position.z + 22;

    const dx = monster.enemy.position.x - startX;
    const dy = monster.enemy.position.y - startY;
    const dz = targetZ - startZ;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (dist === 0) return;

    // 6 projectiles with yaw offsets [-2,-1,0,1,2,3] * 6 degrees
    const offsets = [-2, -1, 0, 1, 2, 3];

    for (const offset of offsets) {
        const projectile = game.entities.spawn();
        if (!projectile) continue;

        projectile.classname = projectileType;
        projectile.category = 'projectile';
        projectile.moveType = 'fly';
        projectile.solid = 'bbox';
        projectile.hull = {
            mins: { x: -4, y: -4, z: -4 },
            maxs: { x: 4, y: 4, z: 4 }
        };

        projectile.position = {
            x: startX,
            y: startY,
            z: startZ
        };

        // Rotate direction by offset * 6 degrees
        const spreadRad = offset * 6 * Math.PI / 180;
        const baseX = dx / dist;
        const baseY = dy / dist;
        const cos = Math.cos(spreadRad);
        const sin = Math.sin(spreadRad);
        const spreadX = baseX * cos - baseY * sin;
        const spreadY = baseX * sin + baseY * cos;

        // Add vertical randomness: vec.z = -vec.z + (random() - 0.5) * 0.1
        const baseZ = dz / dist;
        const randomZ = -baseZ + (Math.random() - 0.5) * 0.1;

        projectile.velocity = {
            x: spreadX * speed,
            y: spreadY * speed,
            z: randomZ * speed
        };

        projectile.data = {
            damage: damage,
            owner: monster,
            spawnTime: game.time
        };

        projectile.touch = (proj, other, g, trace) => {
            if (other && other === proj.data.owner) return;
            if (other && other.health !== undefined) {
                g.dealDamage(other, proj.data.damage, proj.data.owner);
            }
            if (g.effects && trace) {
                g.effects.spawnExplosion(proj.position, 0.2);
            }
            g.entities.remove(proj);
            g.physics.removeEntity(proj);
        };

        projectile.think = (proj, g) => {
            if (g.time - proj.data.spawnTime > 6.0) {
                g.entities.remove(proj);
                g.physics.removeEntity(proj);
            } else {
                proj.nextThink = g.time + 0.5;
            }
        };
        projectile.nextThink = game.time + 0.5;

        game.entities.addToCategory(projectile);
        game.physics.addEntity(projectile);

        if (game.effects) {
            game.effects.attachProjectileTrail(projectile, projectileType);
        }
    }

    // Play attack sound once
    if (game.audio) {
        game.audio.playPositioned('sound/hknight/attack1.wav', monster.position);
    }
}

// Spawn an ogre grenade
function spawnMonsterGrenade(monster, game, damage) {
    if (!monster.enemy) return;

    const projectile = game.entities.spawn();
    if (!projectile) return;

    // Calculate direction to enemy with arc
    const startZ = monster.position.z + 32;
    const dx = monster.enemy.position.x - monster.position.x;
    const dy = monster.enemy.position.y - monster.position.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist === 0) return;

    const speed = 600;

    projectile.classname = 'grenade';
    projectile.category = 'projectile';
    projectile.moveType = 'bounce';
    projectile.solid = 'bbox';
    projectile.hull = {
        mins: { x: -4, y: -4, z: -4 },
        maxs: { x: 4, y: 4, z: 4 }
    };

    projectile.position = {
        x: monster.position.x,
        y: monster.position.y,
        z: startZ
    };

    // Arc towards enemy
    projectile.velocity = {
        x: (dx / dist) * speed,
        y: (dy / dist) * speed,
        z: 200 // Upward arc
    };

    projectile.data = {
        damage: damage,
        owner: monster,
        explodeTime: game.time + 2.5
    };

    // Think callback - explode after time or on ground
    projectile.think = (proj, g) => {
        if (g.time >= proj.data.explodeTime) {
            explodeMonsterGrenade(proj, g);
        } else {
            proj.nextThink = g.time + 0.1;
        }
    };
    projectile.nextThink = game.time + 0.1;

    // Touch callback - explode on enemy hit
    projectile.touch = (proj, other, g, trace) => {
        if (other && other === proj.data.owner) return;

        if (other && other.health !== undefined) {
            explodeMonsterGrenade(proj, g, other);
        } else {
            // Grenades bounce off walls — play bounce sound (weapons/bounce.wav)
            if (g.audio) {
                g.audio.playPositioned('sound/weapons/bounce.wav', proj.position);
            }
        }
    };

    game.entities.addToCategory(projectile);
    game.physics.addEntity(projectile);

    // Play sound
    if (game.audio) {
        game.audio.playSound('weapons/grenade.wav', monster.position);
    }
}

function explodeMonsterGrenade(projectile, game, directHit = null) {
    const center = projectile.position;
    const damage = projectile.data.damage;
    const radius = damage + 40; // Original Quake: radius = damage + 40

    // Direct hit damage
    if (directHit && directHit.health !== undefined) {
        game.dealDamage(directHit, damage, projectile.data.owner);
    }

    // Splash damage to nearby entities (T_RadiusDamage from combat.qc)
    // Original: points = 0.5 * vlen(org - targ.origin), damage = damage - points
    const checkEntities = [...game.entities.players, ...game.entities.monsters];
    for (const entity of checkEntities) {
        if (!entity.active) continue;
        if (entity === directHit) continue; // Already damaged

        const dx = entity.position.x - center.x;
        const dy = entity.position.y - center.y;
        const dz = entity.position.z - center.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (dist < radius) {
            const points = 0.5 * dist;
            const splashDamage = Math.floor(damage - points);
            if (splashDamage > 0) {
                game.dealDamage(entity, splashDamage, projectile.data.owner);
            }
        }
    }

    // Spawn explosion effect
    if (game.effects) {
        game.effects.spawnExplosion(center, 1.0);
    }

    // Play explosion sound
    if (game.audio) {
        game.audio.playSound('weapons/r_exp3.wav', center);
    }

    // Remove grenade
    game.entities.remove(projectile);
    game.physics.removeEntity(projectile);
}

// Spawn zombie thrown gib
function spawnZombieGib(monster, game, damage) {
    if (!monster.enemy) return;

    const projectile = game.entities.spawn();
    if (!projectile) return;

    const startZ = monster.position.z + 32;
    const dx = monster.enemy.position.x - monster.position.x;
    const dy = monster.enemy.position.y - monster.position.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist === 0) return;

    const speed = 600;

    projectile.classname = 'zom_gib';
    projectile.category = 'projectile';
    projectile.moveType = 'bounce';
    projectile.solid = 'bbox';
    projectile.hull = {
        mins: { x: -4, y: -4, z: -4 },
        maxs: { x: 4, y: 4, z: 4 }
    };

    projectile.position = {
        x: monster.position.x,
        y: monster.position.y,
        z: startZ
    };

    projectile.velocity = {
        x: (dx / dist) * speed,
        y: (dy / dist) * speed,
        z: 200
    };

    projectile.data = {
        damage: damage,
        owner: monster,
        spawnTime: game.time
    };

    projectile.touch = (proj, other, g, trace) => {
        if (other && other === proj.data.owner) return;

        if (other && other.health !== undefined) {
            g.dealDamage(other, proj.data.damage, proj.data.owner);
            // Remove on entity hit
            g.entities.remove(proj);
            g.physics.removeEntity(proj);
        } else {
            // Wall bounce — play miss sound (zombie.qc)
            if (g.audio) {
                g.audio.playPositioned('sound/zombie/z_miss.wav', proj.position);
            }
        }
    };

    projectile.think = (proj, g) => {
        if (g.time - proj.data.spawnTime > 3.0) {
            g.entities.remove(proj);
            g.physics.removeEntity(proj);
        } else {
            proj.nextThink = g.time + 0.5;
        }
    };
    projectile.nextThink = game.time + 0.5;

    game.entities.addToCategory(projectile);
    game.physics.addEntity(projectile);

    // Play throw sound
    if (game.audio) {
        game.audio.playSound('zombie/z_shot1.wav', monster.position);
    }
}

/**
 * Spawn dropped ammo from dead monster (soldier.qc, ogre.qc, enforcer.qc)
 * Uses backpack model with skin based on ammo type
 */
function spawnDroppedAmmo(monster, dropInfo, game) {
    if (!dropInfo || !game.entities) return;

    const item = game.entities.spawn();
    if (!item) return;

    item.classname = 'item_backpack';
    item.category = 'item';

    // Position slightly above monster's death position
    item.position = {
        x: monster.position.x,
        y: monster.position.y,
        z: monster.position.z + 24
    };

    // Small random velocity so backpacks scatter
    item.velocity = {
        x: (Math.random() - 0.5) * 100,
        y: (Math.random() - 0.5) * 100,
        z: 100 + Math.random() * 50
    };

    item.moveType = 'toss';
    item.solid = 'trigger';
    item.hull = {
        mins: { x: -16, y: -16, z: 0 },
        maxs: { x: 16, y: 16, z: 56 }
    };

    item.data = {
        ammoType: dropInfo.type,
        ammoCount: dropInfo.count
    };

    // Touch callback - give ammo to player
    item.touch = (itm, other, g) => {
        if (!other || other.classname !== 'player') return;
        if (other.health <= 0) return;

        // Give ammo based on type
        const type = itm.data.ammoType;
        const count = itm.data.ammoCount;

        if (type === 'shells' && other.ammo) {
            other.ammo.shells = Math.min(100, other.ammo.shells + count);
        } else if (type === 'nails' && other.ammo) {
            other.ammo.nails = Math.min(200, other.ammo.nails + count);
        } else if (type === 'rockets' && other.ammo) {
            other.ammo.rockets = Math.min(100, other.ammo.rockets + count);
        } else if (type === 'cells' && other.ammo) {
            other.ammo.cells = Math.min(100, other.ammo.cells + count);
        }

        // Play pickup sound
        if (g.audio) {
            g.audio.playSound('weapons/lock4.wav', itm.position);
        }

        // Remove backpack
        if (itm.mesh && g.renderer) {
            g.renderer.removeFromScene(itm.mesh);
        }
        g.entities.remove(itm);
        g.physics.removeEntity(itm);
    };

    // Remove after 2 minutes if not picked up
    item.think = (itm, g) => {
        if (g.time > itm.data.spawnTime + 120) {
            if (itm.mesh && g.renderer) {
                g.renderer.removeFromScene(itm.mesh);
            }
            g.entities.remove(itm);
            g.physics.removeEntity(itm);
        } else {
            itm.nextThink = g.time + 5;
        }
    };
    item.data.spawnTime = game.time;
    item.nextThink = game.time + 5;

    game.entities.addToCategory(item);
    game.physics.addEntity(item);

    // Load backpack model
    if (game.renderer) {
        game.renderer.loadModel('progs/backpack.mdl', game.pak).then(modelData => {
            if (modelData && item.active) {
                const mesh = game.renderer.createModelInstance(modelData);
                if (mesh) {
                    item.mesh = mesh;
                    mesh.position.set(item.position.x, item.position.y, item.position.z);
                    game.renderer.addToScene(mesh);
                }
            }
        }).catch(() => {});
    }
}
