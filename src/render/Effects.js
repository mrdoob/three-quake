import * as THREE from 'three';
import { QUAKE_PALETTE } from '../loaders/Palette.js';

/**
 * Effects - Particle effects and visual feedback
 *
 * Based on Quake's particle and dlight system from r_part.c and cl_tent.c
 * Matches original Quake behavior as closely as possible.
 */

/**
 * Convert Quake palette index to hex RGB color
 * @param {number} index - Palette index (0-255)
 * @returns {number} Hex RGB color
 */
function paletteToHex(index) {
    const r = QUAKE_PALETTE[index * 3];
    const g = QUAKE_PALETTE[index * 3 + 1];
    const b = QUAKE_PALETTE[index * 3 + 2];
    return (r << 16) | (g << 8) | b;
}

// Original Quake color ramps (exact palette colors)
// ramp1[8] = {0x6f, 0x6d, 0x6b, 0x69, 0x67, 0x65, 0x63, 0x61} - explosion (pt_explode)
// Indices: 111, 109, 107, 105, 103, 101, 99, 97
const RAMP1 = [
    paletteToHex(0x6f), paletteToHex(0x6d), paletteToHex(0x6b), paletteToHex(0x69),
    paletteToHex(0x67), paletteToHex(0x65), paletteToHex(0x63), paletteToHex(0x61)
];

// ramp2[8] = {0x6f, 0x6e, 0x6d, 0x6c, 0x6b, 0x6a, 0x68, 0x66} - explosion2 (pt_explode2)
// Indices: 111, 110, 109, 108, 107, 106, 104, 102
const RAMP2 = [
    paletteToHex(0x6f), paletteToHex(0x6e), paletteToHex(0x6d), paletteToHex(0x6c),
    paletteToHex(0x6b), paletteToHex(0x6a), paletteToHex(0x68), paletteToHex(0x66)
];

// ramp3[6] = {0x6d, 0x6b, 6, 5, 4, 3} - fire colors (pt_fire)
// Indices: 109, 107, 6, 5, 4, 3
const RAMP3 = [
    paletteToHex(0x6d), paletteToHex(0x6b), paletteToHex(6),
    paletteToHex(5), paletteToHex(4), paletteToHex(3)
];

// Quake teleport colors (palette indices 7-14)
// These are actually grays/whites in Quake palette - the cyan appearance
// comes from additive blending and the specific particle texture
const TELEPORT_COLORS = [
    paletteToHex(7), paletteToHex(8), paletteToHex(9), paletteToHex(10),
    paletteToHex(11), paletteToHex(12), paletteToHex(13), paletteToHex(14)
];

// Blood colors (palette indices 67-70)
const BLOOD_COLORS = [paletteToHex(67), paletteToHex(68), paletteToHex(69), paletteToHex(70)];

// Blob colors (palette indices 66-71 for greenish)
const BLOB_COLORS = [
    paletteToHex(66), paletteToHex(67), paletteToHex(68),
    paletteToHex(69), paletteToHex(70), paletteToHex(71)
];

// Blob2 colors (palette indices 150-155 for brownish)
const BLOB2_COLORS = [
    paletteToHex(150), paletteToHex(151), paletteToHex(152),
    paletteToHex(153), paletteToHex(154), paletteToHex(155)
];

// Lava colors (palette indices 224-231)
const LAVA_COLORS = [
    paletteToHex(224), paletteToHex(225), paletteToHex(226), paletteToHex(227),
    paletteToHex(228), paletteToHex(229), paletteToHex(230), paletteToHex(231)
];

// Tracer colors
const TRACER_GREEN = [paletteToHex(52), paletteToHex(60)];  // Green tracer alternating
const TRACER_ORANGE = [paletteToHex(230), paletteToHex(238)];  // Orange tracer alternating

// Voor trail colors (palette indices 152-155, purple)
const VOOR_COLORS = [paletteToHex(152), paletteToHex(153), paletteToHex(154), paletteToHex(155)];

// Entity particles color (palette index 0x6f = 111, bright yellow)
const ENTITY_PARTICLE_COLOR = paletteToHex(0x6f);

// Particle types (matching original Quake r_part.c)
const PT_STATIC = 0;
const PT_GRAV = 1;
const PT_SLOWGRAV = 2;
const PT_FIRE = 3;
const PT_EXPLODE = 4;
const PT_EXPLODE2 = 5;
const PT_BLOB = 6;
const PT_BLOB2 = 7;

// Quake gravity constant
const SV_GRAVITY = 800;

// Number of vertex normals for R_EntityParticles (from anorms.h)
const NUMVERTEXNORMALS = 162;

// Pre-computed vertex normals for entity particles (from Quake's anorms.h)
// These are the 162 normals used for model lighting and entity particle effects
const r_avertexnormals = [
    [-0.525731, 0.000000, 0.850651], [-0.442863, 0.238856, 0.864188],
    [-0.295242, 0.000000, 0.955423], [-0.309017, 0.500000, 0.809017],
    [-0.162460, 0.262866, 0.951056], [0.000000, 0.000000, 1.000000],
    [0.000000, 0.850651, 0.525731], [-0.147621, 0.716567, 0.681718],
    [0.147621, 0.716567, 0.681718], [0.000000, 0.525731, 0.850651],
    [0.309017, 0.500000, 0.809017], [0.525731, 0.000000, 0.850651],
    [0.295242, 0.000000, 0.955423], [0.442863, 0.238856, 0.864188],
    [0.162460, 0.262866, 0.951056], [-0.681718, 0.147621, 0.716567],
    [-0.809017, 0.309017, 0.500000], [-0.587785, 0.425325, 0.688191],
    [-0.850651, 0.525731, 0.000000], [-0.864188, 0.442863, 0.238856],
    [-0.716567, 0.681718, 0.147621], [-0.688191, 0.587785, 0.425325],
    [-0.500000, 0.809017, 0.309017], [-0.238856, 0.864188, 0.442863],
    [-0.425325, 0.688191, 0.587785], [-0.716567, 0.681718, -0.147621],
    [-0.500000, 0.809017, -0.309017], [-0.525731, 0.850651, 0.000000],
    [0.000000, 0.850651, -0.525731], [-0.238856, 0.864188, -0.442863],
    [0.000000, 0.955423, -0.295242], [-0.262866, 0.951056, -0.162460],
    [0.000000, 1.000000, 0.000000], [0.000000, 0.955423, 0.295242],
    [-0.262866, 0.951056, 0.162460], [0.238856, 0.864188, 0.442863],
    [0.262866, 0.951056, 0.162460], [0.500000, 0.809017, 0.309017],
    [0.238856, 0.864188, -0.442863], [0.262866, 0.951056, -0.162460],
    [0.500000, 0.809017, -0.309017], [0.850651, 0.525731, 0.000000],
    [0.716567, 0.681718, 0.147621], [0.716567, 0.681718, -0.147621],
    [0.525731, 0.850651, 0.000000], [0.425325, 0.688191, 0.587785],
    [0.864188, 0.442863, 0.238856], [0.688191, 0.587785, 0.425325],
    [0.809017, 0.309017, 0.500000], [0.681718, 0.147621, 0.716567],
    [0.587785, 0.425325, 0.688191], [0.955423, 0.295242, 0.000000],
    [1.000000, 0.000000, 0.000000], [0.951056, 0.162460, 0.262866],
    [0.850651, -0.525731, 0.000000], [0.955423, -0.295242, 0.000000],
    [0.864188, -0.442863, 0.238856], [0.951056, -0.162460, 0.262866],
    [0.809017, -0.309017, 0.500000], [0.681718, -0.147621, 0.716567],
    [0.850651, 0.000000, 0.525731], [0.864188, 0.442863, -0.238856],
    [0.809017, 0.309017, -0.500000], [0.951056, 0.162460, -0.262866],
    [0.525731, 0.000000, -0.850651], [0.681718, 0.147621, -0.716567],
    [0.681718, -0.147621, -0.716567], [0.850651, 0.000000, -0.525731],
    [0.809017, -0.309017, -0.500000], [0.864188, -0.442863, -0.238856],
    [0.951056, -0.162460, -0.262866], [0.147621, 0.716567, -0.681718],
    [0.309017, 0.500000, -0.809017], [0.425325, 0.688191, -0.587785],
    [0.442863, 0.238856, -0.864188], [0.587785, 0.425325, -0.688191],
    [0.688191, 0.587785, -0.425325], [-0.147621, 0.716567, -0.681718],
    [-0.309017, 0.500000, -0.809017], [0.000000, 0.525731, -0.850651],
    [-0.525731, 0.000000, -0.850651], [-0.442863, 0.238856, -0.864188],
    [-0.295242, 0.000000, -0.955423], [-0.162460, 0.262866, -0.951056],
    [0.000000, 0.000000, -1.000000], [0.295242, 0.000000, -0.955423],
    [0.162460, 0.262866, -0.951056], [-0.442863, -0.238856, -0.864188],
    [-0.309017, -0.500000, -0.809017], [-0.162460, -0.262866, -0.951056],
    [0.000000, -0.850651, -0.525731], [-0.147621, -0.716567, -0.681718],
    [0.147621, -0.716567, -0.681718], [0.000000, -0.525731, -0.850651],
    [0.309017, -0.500000, -0.809017], [0.442863, -0.238856, -0.864188],
    [0.162460, -0.262866, -0.951056], [0.238856, -0.864188, -0.442863],
    [0.500000, -0.809017, -0.309017], [0.425325, -0.688191, -0.587785],
    [0.716567, -0.681718, -0.147621], [0.688191, -0.587785, -0.425325],
    [0.587785, -0.425325, -0.688191], [0.000000, -0.955423, -0.295242],
    [0.000000, -1.000000, 0.000000], [0.262866, -0.951056, -0.162460],
    [0.000000, -0.850651, 0.525731], [0.000000, -0.955423, 0.295242],
    [0.238856, -0.864188, 0.442863], [0.262866, -0.951056, 0.162460],
    [0.500000, -0.809017, 0.309017], [0.716567, -0.681718, 0.147621],
    [0.525731, -0.850651, 0.000000], [-0.238856, -0.864188, -0.442863],
    [-0.500000, -0.809017, -0.309017], [-0.262866, -0.951056, -0.162460],
    [-0.850651, -0.525731, 0.000000], [-0.716567, -0.681718, -0.147621],
    [-0.716567, -0.681718, 0.147621], [-0.525731, -0.850651, 0.000000],
    [-0.500000, -0.809017, 0.309017], [-0.238856, -0.864188, 0.442863],
    [-0.262866, -0.951056, 0.162460], [-0.864188, -0.442863, 0.238856],
    [-0.809017, -0.309017, 0.500000], [-0.688191, -0.587785, 0.425325],
    [-0.681718, -0.147621, 0.716567], [-0.442863, -0.238856, 0.864188],
    [-0.587785, -0.425325, 0.688191], [-0.309017, -0.500000, 0.809017],
    [-0.147621, -0.716567, 0.681718], [-0.425325, -0.688191, 0.587785],
    [-0.162460, -0.262866, 0.951056], [0.442863, -0.238856, 0.864188],
    [0.162460, -0.262866, 0.951056], [0.309017, -0.500000, 0.809017],
    [0.147621, -0.716567, 0.681718], [0.000000, -0.525731, 0.850651],
    [0.425325, -0.688191, 0.587785], [0.587785, -0.425325, 0.688191],
    [0.688191, -0.587785, 0.425325], [-0.955423, 0.295242, 0.000000],
    [-0.951056, 0.162460, 0.262866], [-1.000000, 0.000000, 0.000000],
    [-0.850651, 0.000000, 0.525731], [-0.955423, -0.295242, 0.000000],
    [-0.951056, -0.162460, 0.262866], [-0.864188, 0.442863, -0.238856],
    [-0.951056, 0.162460, -0.262866], [-0.809017, 0.309017, -0.500000],
    [-0.864188, -0.442863, -0.238856], [-0.951056, -0.162460, -0.262866],
    [-0.809017, -0.309017, -0.500000], [-0.681718, 0.147621, -0.716567],
    [-0.681718, -0.147621, -0.716567], [-0.850651, 0.000000, -0.525731],
    [-0.688191, 0.587785, -0.425325], [-0.587785, 0.425325, -0.688191],
    [-0.425325, 0.688191, -0.587785], [-0.425325, -0.688191, -0.587785],
    [-0.587785, -0.425325, -0.688191], [-0.688191, -0.587785, -0.425325]
];

// Angular velocities for entity particles (initialized lazily)
let avelocities = null;

export class Effects {
    constructor(scene, renderer = null, camera = null) {
        this.scene = scene;
        this.renderer = renderer;  // Reference to Renderer for BSP dynamic lighting
        this.camera = camera;      // Reference to camera for distance-based particle scaling
        this.particles = [];
        this.muzzleFlashes = [];
        this.dynamicLights = [];  // Quake-style dlights (Three.js PointLights)
        this.entityParticles = new Map();  // Track entity particle effects by entity

        // Create particle texture matching GLQuake's dottexture (gl_rmisc.c)
        // 8x8 texture with a small dot in the top-left corner
        this.particleTexture = this.createParticleTexture();

        // Create shared geometries and materials
        // GLQuake uses 1.5 unit triangles (r_part.c: VectorScale(vup, 1.5, up))
        // We use a plane that will billboard toward camera
        this.particleGeometry = new THREE.PlaneGeometry(1.5, 1.5);

        // Shared materials with additive blending (matching GLQuake GL_BLEND)
        this.bloodMaterial = new THREE.MeshBasicMaterial({
            color: 0x880000,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            map: this.particleTexture
        });
        this.sparkMaterial = new THREE.MeshBasicMaterial({
            color: 0xffff00,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            map: this.particleTexture
        });
        this.smokeMaterial = new THREE.MeshBasicMaterial({
            color: 0x888888,
            transparent: true,
            opacity: 0.5,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            map: this.particleTexture
        });

        // Muzzle flash
        this.muzzleFlashMaterial = new THREE.SpriteMaterial({
            color: 0xffff44,
            transparent: true,
            blending: THREE.AdditiveBlending
        });
    }

    /**
     * Create particle texture matching GLQuake's dottexture (gl_rmisc.c:59-69)
     * 8x8 texture with a small circular dot for soft-edged particles
     */
    createParticleTexture() {
        // GLQuake dottexture - small dot in top-left corner
        const dottexture = [
            [0,1,1,0,0,0,0,0],
            [1,1,1,1,0,0,0,0],
            [1,1,1,1,0,0,0,0],
            [0,1,1,0,0,0,0,0],
            [0,0,0,0,0,0,0,0],
            [0,0,0,0,0,0,0,0],
            [0,0,0,0,0,0,0,0],
            [0,0,0,0,0,0,0,0],
        ];

        const canvas = document.createElement('canvas');
        canvas.width = 8;
        canvas.height = 8;
        const ctx = canvas.getContext('2d');
        const imageData = ctx.createImageData(8, 8);

        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                const i = (y * 8 + x) * 4;
                imageData.data[i] = 255;     // R
                imageData.data[i + 1] = 255; // G
                imageData.data[i + 2] = 255; // B
                imageData.data[i + 3] = dottexture[y][x] * 255; // A
            }
        }

        ctx.putImageData(imageData, 0, 0);

        const texture = new THREE.CanvasTexture(canvas);
        texture.magFilter = THREE.LinearFilter;
        texture.minFilter = THREE.LinearFilter;
        return texture;
    }

    // Blood splatter
    // Original Quake uses palette indices 67-70 (blood red range)
    blood(position, count = 8) {
        for (let i = 0; i < count; i++) {
            // Use exact palette blood colors (67 + rand()&3)
            const particle = new THREE.Mesh(
                this.particleGeometry,
                new THREE.MeshBasicMaterial({
                    color: BLOOD_COLORS[Math.floor(Math.random() * 4)],
                    transparent: true,
                    blending: THREE.AdditiveBlending,
                    depthWrite: false,
                    map: this.particleTexture
                })
            );
            particle.position.set(position.x, position.y, position.z);

            // Random velocity
            const speed = 100 + Math.random() * 200;
            const angle = Math.random() * Math.PI * 2;
            const upAngle = Math.random() * Math.PI / 2;

            particle.userData.velocity = {
                x: Math.cos(angle) * Math.sin(upAngle) * speed,
                y: Math.sin(angle) * Math.sin(upAngle) * speed,
                z: Math.cos(upAngle) * speed
            };
            particle.userData.life = 0.5 + Math.random() * 0.5;
            particle.userData.particleType = PT_GRAV;

            this.scene.add(particle);
            this.particles.push(particle);
        }
    }

    // Wall/surface impact
    impact(position, normal, count = 5) {
        if (!position) return;

        for (let i = 0; i < count; i++) {
            const particle = new THREE.Mesh(this.particleGeometry, this.sparkMaterial);
            particle.position.set(position.x, position.y, position.z);
            particle.scale.setScalar(0.5);

            // Velocity based on surface normal with spread
            const speed = 50 + Math.random() * 150;
            let vx, vy, vz;

            if (normal) {
                const spread = 0.5;
                vx = (normal.x + (Math.random() - 0.5) * spread) * speed;
                vy = (normal.y + (Math.random() - 0.5) * spread) * speed;
                vz = (normal.z + (Math.random() - 0.5) * spread) * speed;
            } else {
                const angle = Math.random() * Math.PI * 2;
                vx = Math.cos(angle) * speed;
                vy = Math.sin(angle) * speed;
                vz = Math.random() * speed;
            }

            particle.userData.velocity = { x: vx, y: vy, z: vz };
            particle.userData.life = 0.2 + Math.random() * 0.3;
            particle.userData.gravity = true;

            this.scene.add(particle);
            this.particles.push(particle);
        }
    }

    /**
     * Explosion - Quake style particle explosion
     * Original R_ParticleExplosion from r_part.c:
     * - 1024 particles
     * - p->die = cl.time + 5 (5 second lifetime)
     * - p->ramp = rand()&3 (random start 0-3)
     * - Alternates between pt_explode and pt_explode2
     * - Origin scatter: rand()%32 - 16 on each axis
     * - Velocity: rand()%512 - 256 on each axis
     */
    explosion(position) {
        // Dynamic light (Quake: radius 350, duration 0.5s, decay 300)
        this.spawnDynamicLight(position, {
            color: 0xff6600,
            radius: 350,
            duration: 0.5,
            decay: 300
        });

        // Original Quake spawns 1024 particles
        const particleCount = 1024;

        for (let i = 0; i < particleCount; i++) {
            // Alternate between explode (accelerating) and explode2 (decelerating) types
            // Original: if (i & 1) pt_explode else pt_explode2
            const particleType = (i & 1) ? PT_EXPLODE : PT_EXPLODE2;

            const particle = new THREE.Mesh(
                this.particleGeometry,
                new THREE.MeshBasicMaterial({
                    color: RAMP1[0], // Start bright orange (p->color = ramp1[0])
                    transparent: true,
                    blending: THREE.AdditiveBlending,
                    depthWrite: false,
                    map: this.particleTexture
                })
            );

            // Scatter origin ±16 units (Quake: rand()%32 - 16)
            particle.position.set(
                position.x + (Math.random() * 32 - 16),
                position.y + (Math.random() * 32 - 16),
                position.z + (Math.random() * 32 - 16)
            );

            // Velocity -256 to +256 on each axis (Quake: rand()%512 - 256)
            particle.userData.velocity = {
                x: Math.random() * 512 - 256,
                y: Math.random() * 512 - 256,
                z: Math.random() * 512 - 256
            };

            // Original: p->die = cl.time + 5 (5 second lifetime)
            particle.userData.life = 5.0;
            particle.userData.particleType = particleType;
            // Original: p->ramp = rand()&3 (random 0-3)
            particle.userData.ramp = Math.floor(Math.random() * 4);
            particle.userData.colorRamp = particleType === PT_EXPLODE ? RAMP1 : RAMP2;

            this.scene.add(particle);
            this.particles.push(particle);
        }
    }

    // Muzzle flash - Quake style with dynamic light
    // Original Quake: Only uses a dynamic light (dlight) for muzzle flash
    // The visual flash comes from the weapon viewmodel's animation frames
    // No sprite is spawned in the world - see CL_MuzzleFlash in cl_parse.c
    muzzleFlash(position, forward) {
        const flashPos = {
            x: position.x + forward.x * 18,
            y: position.y + forward.y * 18,
            z: position.z + forward.z * 18
        };

        // Dynamic light only (Quake: radius 200-231, duration 0.1s)
        // This is what original Quake does - no sprite, just light
        this.spawnDynamicLight(flashPos, {
            color: 0xffaa44,
            radius: 200 + Math.random() * 31,
            duration: 0.1,
            decay: 0
        });
    }

    /**
     * Set camera reference for distance-based particle scaling
     * @param {THREE.Camera} camera
     */
    setCamera(camera) {
        this.camera = camera;
    }

    /**
     * R_EntityParticles - Particles orbiting an entity (Quad Damage glow)
     * Original from r_part.c lines 124-175
     *
     * Creates 162 particles that orbit around an entity at distance 64,
     * moving along beams of length 16 from the vertex normal directions.
     * Used for the Quad Damage powerup effect.
     *
     * @param {Object} entity - Entity with position {x, y, z}
     * @param {number} time - Current game time
     */
    entityParticles(entity, time) {
        const dist = 64;
        const beamlength = 16;

        // Initialize angular velocities on first call (matches original Quake)
        if (!avelocities) {
            avelocities = [];
            for (let i = 0; i < NUMVERTEXNORMALS; i++) {
                avelocities.push([
                    (Math.random() * 256) * 0.01,
                    (Math.random() * 256) * 0.01,
                    (Math.random() * 256) * 0.01
                ]);
            }
        }

        // Accept either position or origin (for entity objects from different sources)
        const origin = entity.position || entity.origin;

        for (let i = 0; i < NUMVERTEXNORMALS; i++) {
            // Calculate angles based on time and per-normal angular velocities
            const angleY = time * avelocities[i][0];
            const angleP = time * avelocities[i][1];
            // angleR not used for forward vector calculation

            const sy = Math.sin(angleY);
            const cy = Math.cos(angleY);
            const sp = Math.sin(angleP);
            const cp = Math.cos(angleP);

            // Forward vector (from angle calculations)
            const forward = {
                x: cp * cy,
                y: cp * sy,
                z: -sp
            };

            const particle = new THREE.Mesh(
                this.particleGeometry,
                new THREE.MeshBasicMaterial({
                    color: ENTITY_PARTICLE_COLOR,  // 0x6f = bright yellow
                    transparent: true,
                    blending: THREE.AdditiveBlending,
                    depthWrite: false,
                    map: this.particleTexture
                })
            );

            // Position: origin + normal*dist + forward*beamlength
            particle.position.set(
                origin.x + r_avertexnormals[i][0] * dist + forward.x * beamlength,
                origin.y + r_avertexnormals[i][1] * dist + forward.y * beamlength,
                origin.z + r_avertexnormals[i][2] * dist + forward.z * beamlength
            );

            particle.scale.setScalar(0.8);

            // Very short lifetime (p->die = cl.time + 0.01)
            particle.userData.life = 0.01;
            particle.userData.particleType = PT_EXPLODE;  // Original uses pt_explode
            particle.userData.velocity = { x: 0, y: 0, z: 0 };

            this.scene.add(particle);
            this.particles.push(particle);
        }
    }

    /**
     * R_ParticleExplosion2 - Color-parameterized explosion
     * Original from r_part.c lines 321-347
     *
     * 512 particles with cycling colors from colorStart through colorLength range.
     * Used by some QuakeC mods and effects.
     *
     * @param {Object} position - Explosion center {x, y, z}
     * @param {number} colorStart - Starting palette index
     * @param {number} colorLength - Number of colors to cycle through
     */
    particleExplosion2(position, colorStart, colorLength) {
        let colorMod = 0;

        for (let i = 0; i < 512; i++) {
            const particle = new THREE.Mesh(
                this.particleGeometry,
                new THREE.MeshBasicMaterial({
                    // Color cycles through range: colorStart + (colorMod % colorLength)
                    color: paletteToHex(colorStart + (colorMod % colorLength)),
                    transparent: true,
                    blending: THREE.AdditiveBlending,
                    depthWrite: false,
                    map: this.particleTexture
                })
            );
            colorMod++;

            // Scatter origin ±16 units (Quake: rand()%32 - 16)
            particle.position.set(
                position.x + (Math.random() * 32 - 16),
                position.y + (Math.random() * 32 - 16),
                position.z + (Math.random() * 32 - 16)
            );

            // Velocity -256 to +256 on each axis (Quake: rand()%512 - 256)
            particle.userData.velocity = {
                x: Math.random() * 512 - 256,
                y: Math.random() * 512 - 256,
                z: Math.random() * 512 - 256
            };

            // p->die = cl.time + 0.3
            particle.userData.life = 0.3;
            particle.userData.particleType = PT_BLOB;

            this.scene.add(particle);
            this.particles.push(particle);
        }

        // Dynamic light
        this.spawnDynamicLight(position, {
            color: paletteToHex(colorStart),
            radius: 350,
            duration: 0.3,
            decay: 300
        });
    }

    /**
     * R_RunParticleEffect - Generic particle effect
     * Original from r_part.c lines 400-450
     *
     * For count == 1024: same as R_ParticleExplosion
     * Otherwise: short-lived particles with color variation
     *
     * @param {Object} position - Effect origin {x, y, z}
     * @param {Object} dir - Direction vector {x, y, z}
     * @param {number} color - Base palette color index
     * @param {number} count - Number of particles
     */
    runParticleEffect(position, dir, color, count) {
        for (let i = 0; i < count; i++) {
            const particle = new THREE.Mesh(
                this.particleGeometry,
                new THREE.MeshBasicMaterial({
                    color: 0xffffff,
                    transparent: true,
                    blending: THREE.AdditiveBlending,
                    depthWrite: false,
                    map: this.particleTexture
                })
            );

            if (count === 1024) {
                // Rocket explosion - same as R_ParticleExplosion
                const particleType = (i & 1) ? PT_EXPLODE : PT_EXPLODE2;

                particle.material.color.setHex(RAMP1[0]);
                particle.position.set(
                    position.x + (Math.random() * 32 - 16),
                    position.y + (Math.random() * 32 - 16),
                    position.z + (Math.random() * 32 - 16)
                );
                particle.userData.velocity = {
                    x: Math.random() * 512 - 256,
                    y: Math.random() * 512 - 256,
                    z: Math.random() * 512 - 256
                };
                particle.userData.life = 5.0;
                particle.userData.particleType = particleType;
                particle.userData.ramp = Math.floor(Math.random() * 4);
                particle.userData.colorRamp = particleType === PT_EXPLODE ? RAMP1 : RAMP2;
            } else {
                // Generic particle effect
                // p->die = cl.time + 0.1*(rand()%5) = 0 to 0.4 seconds
                // p->color = (color&~7) + (rand()&7) - keeps upper bits, randomizes lower 3
                const baseColor = color & ~7;
                const randomColor = baseColor + (Math.floor(Math.random() * 8));
                particle.material.color.setHex(paletteToHex(randomColor));

                // Scatter: rand()&15 - 8 = ±8
                particle.position.set(
                    position.x + (Math.floor(Math.random() * 16) - 8),
                    position.y + (Math.floor(Math.random() * 16) - 8),
                    position.z + (Math.floor(Math.random() * 16) - 8)
                );

                // Velocity: dir * 15 (original has commented out randomness)
                particle.userData.velocity = {
                    x: dir.x * 15,
                    y: dir.y * 15,
                    z: dir.z * 15
                };

                particle.userData.life = 0.1 * (Math.floor(Math.random() * 5));
                particle.userData.particleType = PT_SLOWGRAV;
            }

            this.scene.add(particle);
            this.particles.push(particle);
        }
    }

    /**
     * Spawn a dynamic light (Quake dlight)
     * Creates both a Three.js PointLight and adds to Renderer's BSP lighting system
     * @param {Object} position - {x, y, z}
     * @param {Object} options - {color, radius, duration, decay}
     */
    spawnDynamicLight(position, options = {}) {
        const color = options.color || 0xffffff;
        const radius = options.radius || 200;
        const duration = options.duration || 0.5;
        const decay = options.decay || 0;

        // Create Three.js PointLight for dynamic objects (models, etc.)
        const light = new THREE.PointLight(color, 2, radius);
        light.position.set(position.x, position.y, position.z);

        light.userData.startTime = performance.now() / 1000;
        light.userData.duration = duration;
        light.userData.decay = decay;
        light.userData.startRadius = radius;
        light.userData.startIntensity = 2;

        this.scene.add(light);
        this.dynamicLights.push(light);

        // Also add to Renderer's BSP shader-based dynamic light system
        // This illuminates the world geometry which uses custom shaders
        if (this.renderer) {
            // Convert hex color to normalized RGB
            const r = ((color >> 16) & 0xff) / 255;
            const g = ((color >> 8) & 0xff) / 255;
            const b = (color & 0xff) / 255;

            this.renderer.addDynamicLight({
                position: { x: position.x, y: position.y, z: position.z },
                radius: radius,
                color: { r, g, b },
                decay: decay,
                die: duration
            });
        }

        return light;
    }

    // Trail effect for projectiles
    trail(position, color = 0xffff00) {
        const particle = new THREE.Mesh(
            this.particleGeometry,
            new THREE.MeshBasicMaterial({
                color,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                map: this.particleTexture
            })
        );
        particle.position.set(position.x, position.y, position.z);

        particle.userData.velocity = { x: 0, y: 0, z: 0 };
        particle.userData.life = 0.2;
        particle.userData.gravity = false;
        particle.userData.fadeOut = true;

        this.scene.add(particle);
        this.particles.push(particle);
    }

    // Alias for explosion (used by monster projectiles)
    spawnExplosion(position, scale = 1.0) {
        // Dynamic light
        this.spawnDynamicLight(position, {
            color: 0xff6600,
            radius: 350 * scale,
            duration: 0.5,
            decay: 300
        });

        // Add some spark particles
        for (let i = 0; i < Math.floor(5 * scale); i++) {
            const particle = new THREE.Mesh(this.particleGeometry, this.sparkMaterial);
            particle.position.set(position.x, position.y, position.z);
            particle.scale.setScalar(0.5);

            const speed = 100 + Math.random() * 200;
            const angle = Math.random() * Math.PI * 2;
            const upAngle = Math.random() * Math.PI;

            particle.userData.velocity = {
                x: Math.cos(angle) * Math.sin(upAngle) * speed,
                y: Math.sin(angle) * Math.sin(upAngle) * speed,
                z: Math.cos(upAngle) * speed
            };
            particle.userData.life = 0.3 + Math.random() * 0.3;
            particle.userData.gravity = true;

            this.scene.add(particle);
            this.particles.push(particle);
        }
    }

    // Attach a visual trail to a projectile entity
    attachProjectileTrail(projectile, type = 'fireball') {
        // Determine color based on projectile type
        let color = 0xffaa00; // Default orange fireball
        let size = 8;

        switch (type) {
            case 'rocket':
                color = 0xff6600; // Bright orange
                size = 10;
                break;
            case 'nail':
                color = 0xffff00; // Yellow
                size = 3;
                break;
            case 'super_nail':
                color = 0xaa88ff; // Purple
                size = 4;
                break;
            case 'w_spike': // Scrag spit
                color = 0x00ff88;
                size = 6;
                break;
            case 'k_spike': // Death Knight magic
                color = 0xff4400;
                size = 8;
                break;
            case 'v_spike': // Vore ball
                color = 0xaa00ff;
                size = 12;
                break;
            case 'grenade':
                color = 0x888888;
                size = 6;
                break;
            case 'laser':
                color = 0xffff00; // Yellow
                size = 4;
                break;
            case 'zom_gib':
                color = 0x880000;
                size = 4;
                break;
        }

        // Create a sprite to represent the projectile
        const material = new THREE.SpriteMaterial({
            color: color,
            transparent: true,
            blending: THREE.AdditiveBlending
        });

        const sprite = new THREE.Sprite(material);
        sprite.scale.setScalar(size);
        sprite.position.set(projectile.position.x, projectile.position.y, projectile.position.z);

        this.scene.add(sprite);

        // Store reference on projectile for updating
        projectile.mesh = sprite;
        projectile.data.trailColor = color;

        // Update function to call each frame
        projectile.updateVisual = (proj) => {
            if (proj.mesh) {
                proj.mesh.position.set(proj.position.x, proj.position.y, proj.position.z);

                // Spawn trail particles
                this.trail(proj.position, proj.data.trailColor);
            }
        };
    }

    // Remove projectile visual
    removeProjectileVisual(projectile) {
        if (projectile.mesh) {
            this.scene.remove(projectile.mesh);
            if (projectile.mesh.material) {
                projectile.mesh.material.dispose();
            }
            projectile.mesh = null;
        }
    }

    update(deltaTime) {
        // Original Quake timing variables from R_DrawParticles:
        // frametime = cl.time - cl.oldtime
        // time3 = frametime * 15 (for pt_explode2 ramp)
        // time2 = frametime * 10 (for pt_explode ramp)
        // time1 = frametime * 5 (for pt_fire ramp)
        // grav = frametime * sv_gravity.value * 0.05 (sv_gravity = 800, so grav = frametime * 40)
        // dvel = 4 * frametime
        const frametime = deltaTime;
        const time3 = frametime * 15;
        const time2 = frametime * 10;
        const time1 = frametime * 5;
        const grav = frametime * SV_GRAVITY * 0.05;  // = frametime * 40
        const dvel = 4 * frametime;

        // Update particles
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const particle = this.particles[i];
            const v = particle.userData.velocity;

            // Move particle (p->org += p->vel * frametime)
            particle.position.x += v.x * frametime;
            particle.position.y += v.y * frametime;
            particle.position.z += v.z * frametime;

            // Billboard: make particle face camera (GLQuake uses vup/vright vectors)
            // Copy camera quaternion so the plane always faces the viewer
            if (this.camera) {
                particle.quaternion.copy(this.camera.quaternion);
            }

            // Distance-based scaling (GLQuake R_DrawParticles lines 714-719)
            // Particles scale up with distance to prevent them from disappearing
            // Original: scale = 1 + (dist_to_camera) * 0.004, minimum 1
            if (this.camera) {
                const dx = particle.position.x - this.camera.position.x;
                const dy = particle.position.y - this.camera.position.y;
                const dz = particle.position.z - this.camera.position.z;

                // Calculate distance along view direction (dot product with forward)
                // In GLQuake this is: (p->org - r_origin) dot vpn
                const camDir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
                const distAlongView = dx * camDir.x + dy * camDir.y + dz * camDir.z;

                let scale;
                if (distAlongView < 20) {
                    scale = 1;
                } else {
                    scale = 1 + distAlongView * 0.004;
                }

                // Apply scale (base size is 1.5 like GLQuake)
                particle.scale.setScalar(scale);
            }

            // Handle particle type physics (from R_DrawParticles switch statement)
            const ptype = particle.userData.particleType;

            switch (ptype) {
                case PT_STATIC:
                    // No physics
                    break;

                case PT_FIRE:
                    // p->ramp += time1; if (ramp >= 6) die; else color = ramp3[ramp]
                    // p->vel[2] += grav (upward force)
                    particle.userData.ramp += time1;
                    if (particle.userData.ramp >= 6) {
                        particle.userData.life = -1;
                    } else {
                        const rampIndex = Math.floor(particle.userData.ramp);
                        particle.material.color.setHex(RAMP3[rampIndex]);
                    }
                    v.z += grav;  // Fire rises
                    break;

                case PT_EXPLODE:
                    // p->ramp += time2; if (ramp >= 8) die; else color = ramp1[ramp]
                    // vel[i] += vel[i] * dvel for all axes
                    // vel[2] -= grav
                    particle.userData.ramp += time2;
                    if (particle.userData.ramp >= 8) {
                        particle.userData.life = -1;
                    } else {
                        const rampIndex = Math.floor(particle.userData.ramp);
                        particle.material.color.setHex(RAMP1[rampIndex]);
                    }
                    v.x += v.x * dvel;
                    v.y += v.y * dvel;
                    v.z += v.z * dvel;
                    v.z -= grav;
                    break;

                case PT_EXPLODE2:
                    // p->ramp += time3; if (ramp >= 8) die; else color = ramp2[ramp]
                    // vel[i] -= vel[i] * frametime for all axes
                    // vel[2] -= grav
                    particle.userData.ramp += time3;
                    if (particle.userData.ramp >= 8) {
                        particle.userData.life = -1;
                    } else {
                        const rampIndex = Math.floor(particle.userData.ramp);
                        particle.material.color.setHex(RAMP2[rampIndex]);
                    }
                    v.x -= v.x * frametime;
                    v.y -= v.y * frametime;
                    v.z -= v.z * frametime;
                    v.z -= grav;
                    break;

                case PT_BLOB:
                    // vel[i] += vel[i] * dvel for all axes
                    // vel[2] -= grav
                    v.x += v.x * dvel;
                    v.y += v.y * dvel;
                    v.z += v.z * dvel;
                    v.z -= grav;
                    break;

                case PT_BLOB2:
                    // vel[i] -= vel[i] * dvel for i=0,1 (X, Y only)
                    // vel[2] -= grav
                    v.x -= v.x * dvel;
                    v.y -= v.y * dvel;
                    v.z -= grav;
                    break;

                case PT_GRAV:
                    // vel[2] -= grav (standard gravity, same as slowgrav in non-Quake2)
                    v.z -= grav;
                    break;

                case PT_SLOWGRAV:
                    // vel[2] -= grav (same reduced gravity as others)
                    v.z -= grav;
                    break;

                default:
                    // Legacy behavior for particles without explicit type
                    if (particle.userData.gravity) {
                        if (particle.userData.slowGravity) {
                            v.z -= grav;  // Use proper Quake grav
                        } else {
                            v.z -= grav;  // Use proper Quake grav (not full 800)
                        }
                    }
                    break;
            }

            // Update life
            particle.userData.life -= deltaTime;

            // Fade out (for non-Quake style particles)
            if (particle.userData.fadeOut && particle.material.opacity !== undefined) {
                particle.material.opacity = Math.max(0, particle.userData.life * 2);
            }

            // Remove dead particles
            if (particle.userData.life <= 0) {
                this.scene.remove(particle);
                if (particle.geometry) particle.geometry.dispose();
                if (particle.material) particle.material.dispose();
                this.particles.splice(i, 1);
            }
        }

        // Update dynamic lights
        const now = performance.now() / 1000;
        for (let i = this.dynamicLights.length - 1; i >= 0; i--) {
            const light = this.dynamicLights[i];
            const elapsed = now - light.userData.startTime;
            const progress = elapsed / light.userData.duration;

            if (progress >= 1) {
                this.scene.remove(light);
                light.dispose();
                this.dynamicLights.splice(i, 1);
            } else {
                // Decay light intensity and radius over time
                const fade = 1 - progress;
                light.intensity = light.userData.startIntensity * fade;

                // Apply decay if specified (Quake: radius -= decay * frametime)
                if (light.userData.decay > 0) {
                    light.distance = Math.max(0, light.userData.startRadius - light.userData.decay * elapsed);
                }
            }
        }

        // Update muzzle flashes
        for (let i = this.muzzleFlashes.length - 1; i >= 0; i--) {
            const flash = this.muzzleFlashes[i];
            flash.userData.life -= deltaTime;

            if (flash.userData.life <= 0) {
                this.scene.remove(flash);
                flash.material.dispose();
                this.muzzleFlashes.splice(i, 1);
            }
        }
    }

    /**
     * Rocket/grenade trail - spawns particles along path from start to end
     * Original R_RocketTrail from r_part.c
     *
     * Trail types:
     * 0 = rocket fire (pt_fire, ramp3 colors)
     * 1 = smoke/grenade (pt_fire, darker ramp3)
     * 2 = blood (pt_grav, red colors 67-70)
     * 3 = tracer (green, spiral motion)
     * 4 = slight blood (pt_grav, every 6 units)
     * 5 = tracer2 (orange/yellow, spiral motion)
     * 6 = voor trail (purple, pt_static)
     *
     * Particles are spawned every 3 units along the path (or 1 unit for type >= 128)
     *
     * @param {Object} start - Start position {x, y, z}
     * @param {Object} end - End position {x, y, z}
     * @param {number} type - Trail type (0-6, or +128 for fine trails)
     */
    rocketTrail(start, end, type = 0) {
        // Calculate direction and length
        const vec = {
            x: end.x - start.x,
            y: end.y - start.y,
            z: end.z - start.z
        };
        let len = Math.sqrt(vec.x * vec.x + vec.y * vec.y + vec.z * vec.z);

        if (len === 0) return;

        // Normalize
        vec.x /= len;
        vec.y /= len;
        vec.z /= len;

        // Determine step size (original: 3 units, or 1 for type >= 128)
        let dec;
        if (type >= 128) {
            dec = 1;
            type -= 128;
        } else {
            dec = 3;
        }

        // Current position along path
        const pos = { x: start.x, y: start.y, z: start.z };

        // Static tracer counter for alternating spiral
        if (this.tracerCount === undefined) this.tracerCount = 0;

        while (len > 0) {
            len -= dec;

            const particle = new THREE.Mesh(
                this.particleGeometry,
                new THREE.MeshBasicMaterial({
                    color: 0xffffff,
                    transparent: true,
                    blending: THREE.AdditiveBlending,
                    depthWrite: false,
                    map: this.particleTexture
                })
            );

            // Default: no velocity
            particle.userData.velocity = { x: 0, y: 0, z: 0 };
            particle.userData.life = 2;  // Default die time

            switch (type) {
                case 0:  // Rocket trail - fire
                    particle.userData.ramp = Math.floor(Math.random() * 4);
                    particle.material.color.setHex(RAMP3[particle.userData.ramp] || 0xff8800);
                    particle.userData.particleType = PT_FIRE;
                    // Scatter: rand()%6 - 3
                    particle.position.set(
                        pos.x + (Math.random() * 6 - 3),
                        pos.y + (Math.random() * 6 - 3),
                        pos.z + (Math.random() * 6 - 3)
                    );
                    break;

                case 1:  // Smoke trail
                    particle.userData.ramp = 2 + Math.floor(Math.random() * 4);
                    particle.material.color.setHex(RAMP3[Math.min(particle.userData.ramp, 5)] || 0x666666);
                    particle.userData.particleType = PT_FIRE;
                    particle.position.set(
                        pos.x + (Math.random() * 6 - 3),
                        pos.y + (Math.random() * 6 - 3),
                        pos.z + (Math.random() * 6 - 3)
                    );
                    break;

                case 2:  // Blood
                    particle.userData.particleType = PT_GRAV;
                    // Color 67 + (rand()&3) - exact palette blood colors
                    particle.material.color.setHex(BLOOD_COLORS[Math.floor(Math.random() * 4)]);
                    particle.position.set(
                        pos.x + (Math.random() * 6 - 3),
                        pos.y + (Math.random() * 6 - 3),
                        pos.z + (Math.random() * 6 - 3)
                    );
                    break;

                case 3:  // Tracer (green)
                case 5:  // Tracer2 (orange)
                    particle.userData.life = 0.5;
                    particle.userData.particleType = PT_STATIC;
                    // Alternating colors - exact palette
                    // Original: 52 + ((tracercount&4)<<1) for green = 52 or 60
                    // Original: 230 + ((tracercount&4)<<1) for orange = 230 or 238
                    if (type === 3) {
                        particle.material.color.setHex((this.tracerCount & 4) ? TRACER_GREEN[1] : TRACER_GREEN[0]);
                    } else {
                        particle.material.color.setHex((this.tracerCount & 4) ? TRACER_ORANGE[1] : TRACER_ORANGE[0]);
                    }
                    this.tracerCount++;
                    // Position exactly on path
                    particle.position.set(pos.x, pos.y, pos.z);
                    // Spiral perpendicular velocity
                    if (this.tracerCount & 1) {
                        particle.userData.velocity.x = 30 * vec.y;
                        particle.userData.velocity.y = 30 * -vec.x;
                    } else {
                        particle.userData.velocity.x = 30 * -vec.y;
                        particle.userData.velocity.y = 30 * vec.x;
                    }
                    break;

                case 4:  // Slight blood (less frequent)
                    particle.userData.particleType = PT_GRAV;
                    particle.material.color.setHex(BLOOD_COLORS[Math.floor(Math.random() * 4)]);
                    particle.position.set(
                        pos.x + (Math.random() * 6 - 3),
                        pos.y + (Math.random() * 6 - 3),
                        pos.z + (Math.random() * 6 - 3)
                    );
                    len -= 3;  // Extra skip for slight blood
                    break;

                case 6:  // Voor trail (purple)
                    // Color: 9*16 + 8 + (rand()&3) = 152-155 - exact palette purple
                    particle.material.color.setHex(VOOR_COLORS[Math.floor(Math.random() * 4)]);
                    particle.userData.particleType = PT_STATIC;
                    particle.userData.life = 0.3;
                    particle.position.set(
                        pos.x + (Math.random() * 16 - 8),
                        pos.y + (Math.random() * 16 - 8),
                        pos.z + (Math.random() * 16 - 8)
                    );
                    break;

                default:
                    particle.material.color.setHex(0xffaa00);
                    particle.position.set(pos.x, pos.y, pos.z);
            }

            this.scene.add(particle);
            this.particles.push(particle);

            // Move along path
            pos.x += vec.x * dec;
            pos.y += vec.y * dec;
            pos.z += vec.z * dec;
        }
    }

    /**
     * Lava splash effect
     * Original R_LavaSplash from r_part.c
     *
     * Grid: 32x32 on X/Y (i,j from -16 to 15)
     * Z: single layer with random 0-63 offset
     * Colors: palette 224 + (rand()&7) (orange/red lava)
     * Lifetime: 2 + (rand()&31) * 0.02 (2.0 to 2.62 seconds)
     * Direction: dir = (j*8 + rand()&7, i*8 + rand()&7, 256)
     * Velocity: normalized direction * (50 + (rand()&63))
     * Type: pt_slowgrav
     *
     * @param {Object} position - Lava splash center {x, y, z}
     */
    lavaSplash(position) {
        // 32x32 grid = 1024 particles
        for (let i = -16; i < 16; i++) {
            for (let j = -16; j < 16; j++) {
                const particle = new THREE.Mesh(
                    this.particleGeometry,
                    new THREE.MeshBasicMaterial({
                        // Color 224 + (rand()&7) = exact palette lava colors
                        color: LAVA_COLORS[Math.floor(Math.random() * 8)],
                        transparent: true,
                        blending: THREE.AdditiveBlending,
                        depthWrite: false,
                        map: this.particleTexture
                    })
                );

                // Direction: (j*8 + rand()&7, i*8 + rand()&7, 256)
                const dirX = j * 8 + (Math.random() * 8) | 0;
                const dirY = i * 8 + (Math.random() * 8) | 0;
                const dirZ = 256;

                // Position: org + dir for X/Y, org + rand()&63 for Z
                particle.position.set(
                    position.x + dirX,
                    position.y + dirY,
                    position.z + (Math.random() * 64) | 0
                );

                // Normalize and scale velocity
                const dirLen = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ);
                const vel = 50 + (Math.random() * 64) | 0;

                particle.userData.velocity = {
                    x: (dirX / dirLen) * vel,
                    y: (dirY / dirLen) * vel,
                    z: (dirZ / dirLen) * vel
                };

                // Lifetime: 2 + (rand()&31) * 0.02
                particle.userData.life = 2 + (Math.floor(Math.random() * 32)) * 0.02;
                particle.userData.particleType = PT_SLOWGRAV;

                this.scene.add(particle);
                this.particles.push(particle);
            }
        }

        // Dynamic light for lava effect
        this.spawnDynamicLight(position, {
            color: 0xff4400,
            radius: 300,
            duration: 0.5,
            decay: 400
        });
    }

    /**
     * Blob explosion (tarbaby death)
     * Original R_BlobExplosion from r_part.c
     *
     * 1024 particles, alternating pt_blob and pt_blob2
     * pt_blob: color 66 + rand()%6 (greenish)
     * pt_blob2: color 150 + rand()%6 (brownish)
     * Lifetime: 1 + (rand()&8)*0.05 (1.0 to 1.4 seconds)
     *
     * @param {Object} position - Explosion center {x, y, z}
     */
    blobExplosion(position) {
        for (let i = 0; i < 1024; i++) {
            const particle = new THREE.Mesh(
                this.particleGeometry,
                new THREE.MeshBasicMaterial({
                    color: 0xffffff,
                    transparent: true,
                    blending: THREE.AdditiveBlending,
                    depthWrite: false,
                    map: this.particleTexture
                })
            );

            // Scatter origin ±16 units
            particle.position.set(
                position.x + (Math.random() * 32 - 16),
                position.y + (Math.random() * 32 - 16),
                position.z + (Math.random() * 32 - 16)
            );

            // Velocity -256 to +256
            particle.userData.velocity = {
                x: Math.random() * 512 - 256,
                y: Math.random() * 512 - 256,
                z: Math.random() * 512 - 256
            };

            // Lifetime: 1 + (rand()&8)*0.05
            particle.userData.life = 1 + (Math.floor(Math.random() * 9)) * 0.05;

            if (i & 1) {
                // pt_blob - greenish (color 66 + rand()%6) - exact palette
                particle.userData.particleType = PT_BLOB;
                particle.material.color.setHex(BLOB_COLORS[Math.floor(Math.random() * 6)]);
            } else {
                // pt_blob2 - brownish (color 150 + rand()%6) - exact palette
                particle.userData.particleType = PT_BLOB2;
                particle.material.color.setHex(BLOB2_COLORS[Math.floor(Math.random() * 6)]);
            }

            this.scene.add(particle);
            this.particles.push(particle);
        }

        // Dynamic light
        this.spawnDynamicLight(position, {
            color: 0x88ff88,
            radius: 350,
            duration: 0.5,
            decay: 300
        });
    }

    /**
     * Lightning beam effect (TE_LIGHTNING from cl_tent.c)
     *
     * Original Quake uses model v_light.mdl and renders the beam as
     * a segmented sprite-based bolt. We simulate this with multiple
     * jagged lines and particle effects.
     *
     * @param {Object} start - Start position {x, y, z}
     * @param {Object} end - End position {x, y, z}
     * @param {number} entityNum - Entity firing the lightning (for beam tracking)
     */
    lightningBeam(start, end, entityNum = 0) {
        // Calculate beam direction
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const dz = end.z - start.z;
        const length = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (length < 1) return;

        // Create main beam (bright core)
        const mainMaterial = new THREE.LineBasicMaterial({
            color: 0xaaaaff,
            linewidth: 3,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending
        });

        // Create jagged lightning path with random displacement
        // Original Quake uses 8 segments per 64 units
        const segmentsPerUnit = 1 / 64;
        const segments = Math.max(8, Math.floor(length * segmentsPerUnit * 8));
        const points = [];
        const stepX = dx / segments;
        const stepY = dy / segments;
        const stepZ = dz / segments;

        // Calculate perpendicular vectors for 3D jitter
        const lenXY = Math.sqrt(dx * dx + dy * dy);
        let perpX, perpY, perpZ;
        if (lenXY > 0.01) {
            perpX = -dy / lenXY;
            perpY = dx / lenXY;
            perpZ = 0;
        } else {
            perpX = 1;
            perpY = 0;
            perpZ = 0;
        }

        for (let i = 0; i <= segments; i++) {
            // Jitter amount - more jitter in the middle, none at endpoints
            const t = i / segments;
            const jitterScale = Math.sin(t * Math.PI) * 15;  // Max jitter 15 units
            const jitterAmount = (i > 0 && i < segments) ? jitterScale : 0;

            points.push(new THREE.Vector3(
                start.x + stepX * i + (Math.random() - 0.5) * jitterAmount * perpX,
                start.y + stepY * i + (Math.random() - 0.5) * jitterAmount * perpY,
                start.z + stepZ * i + (Math.random() - 0.5) * jitterAmount * 0.7
            ));
        }

        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const line = new THREE.Line(geometry, mainMaterial);
        line.userData.life = 0.1;  // Brief flash

        this.scene.add(line);
        this.muzzleFlashes.push(line);

        // Add secondary beam for glow effect (slightly offset)
        const glowMaterial = new THREE.LineBasicMaterial({
            color: 0x4444ff,
            linewidth: 6,
            transparent: true,
            opacity: 0.4,
            blending: THREE.AdditiveBlending
        });

        // Slightly different jitter for glow
        const glowPoints = [];
        for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            const jitterScale = Math.sin(t * Math.PI) * 20;
            const jitterAmount = (i > 0 && i < segments) ? jitterScale : 0;

            glowPoints.push(new THREE.Vector3(
                start.x + stepX * i + (Math.random() - 0.5) * jitterAmount * perpX,
                start.y + stepY * i + (Math.random() - 0.5) * jitterAmount * perpY,
                start.z + stepZ * i + (Math.random() - 0.5) * jitterAmount * 0.7
            ));
        }

        const glowGeometry = new THREE.BufferGeometry().setFromPoints(glowPoints);
        const glowLine = new THREE.Line(glowGeometry, glowMaterial);
        glowLine.userData.life = 0.1;

        this.scene.add(glowLine);
        this.muzzleFlashes.push(glowLine);

        // Spawn spark particles along the beam
        const particleCount = Math.floor(length / 32);
        for (let i = 0; i < particleCount; i++) {
            const t = Math.random();
            const particle = new THREE.Mesh(
                this.particleGeometry,
                new THREE.MeshBasicMaterial({
                    color: 0xaaaaff,
                    transparent: true,
                    blending: THREE.AdditiveBlending,
                    depthWrite: false,
                    map: this.particleTexture
                })
            );

            particle.position.set(
                start.x + dx * t + (Math.random() - 0.5) * 10,
                start.y + dy * t + (Math.random() - 0.5) * 10,
                start.z + dz * t + (Math.random() - 0.5) * 10
            );
            particle.scale.setScalar(0.5);

            // Random outward velocity
            particle.userData.velocity = {
                x: (Math.random() - 0.5) * 100,
                y: (Math.random() - 0.5) * 100,
                z: (Math.random() - 0.5) * 100
            };
            particle.userData.life = 0.15 + Math.random() * 0.1;
            particle.userData.particleType = PT_STATIC;
            particle.userData.fadeOut = true;

            this.scene.add(particle);
            this.particles.push(particle);
        }

        // Dynamic light at start (source)
        this.spawnDynamicLight(start, {
            color: 0x4444ff,
            radius: 200,
            duration: 0.1,
            decay: 0
        });

        // Dynamic light at end (impact)
        this.spawnDynamicLight(end, {
            color: 0x6666ff,
            radius: 150,
            duration: 0.1,
            decay: 0
        });
    }

    /**
     * Teleport splash effect - spawns particles in a 3D grid pattern radiating outward
     * Original Quake: R_TeleportSplash from r_part.c
     *
     * Grid: -16 to 16 step 4 on X/Y, -24 to 32 step 4 on Z = 8*8*14 = 896 particles
     * Colors: palette 7 + (rand()&7) (indices 7-14 = cyan range)
     * Lifetime: 0.2 + (rand()&7) * 0.02 (0.2 to 0.34 seconds)
     * Direction: dir[0] = j*8, dir[1] = i*8, dir[2] = k*8
     * Velocity: normalized direction * (50 + (rand()&63))
     * Type: pt_slowgrav
     *
     * @param {Object} position - Teleport destination {x, y, z}
     */
    teleportSplash(position) {
        const step = 4;  // Grid step size (original Quake)

        // Grid from -16 to 16 on X/Y, -24 to 32 on Z (original Quake bounds)
        for (let i = -16; i < 16; i += step) {
            for (let j = -16; j < 16; j += step) {
                for (let k = -24; k < 32; k += step) {
                    const particle = new THREE.Mesh(
                        this.particleGeometry,
                        new THREE.MeshBasicMaterial({
                            // Original: p->color = 7 + (rand()&7)
                            color: TELEPORT_COLORS[Math.floor(Math.random() * 8)],
                            transparent: true,
                            blending: THREE.AdditiveBlending,
                            depthWrite: false,
                            map: this.particleTexture
                        })
                    );

                    // Position with small random scatter (Quake: org = position + grid + (rand()&3))
                    particle.position.set(
                        position.x + i + (Math.random() * 4),
                        position.y + j + (Math.random() * 4),
                        position.z + k + (Math.random() * 4)
                    );

                    particle.scale.setScalar(0.8);

                    // Direction calculation (Original: dir[0] = j*8, dir[1] = i*8, dir[2] = k*8)
                    const dirX = j * 8;
                    const dirY = i * 8;
                    const dirZ = k * 8;

                    // Normalize direction
                    const dirLen = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ);

                    if (dirLen > 0) {
                        // Velocity: VectorScale(normalized_dir, vel, p->vel)
                        // where vel = 50 + (rand()&63) (50-113 range)
                        const speed = 50 + (Math.random() * 64) | 0;
                        particle.userData.velocity = {
                            x: (dirX / dirLen) * speed,
                            y: (dirY / dirLen) * speed,
                            z: (dirZ / dirLen) * speed
                        };
                    } else {
                        // Center particle - no velocity
                        particle.userData.velocity = { x: 0, y: 0, z: 0 };
                    }

                    // Lifetime: 0.2 + (rand()&7) * 0.02 (0.2 to 0.34 seconds)
                    particle.userData.life = 0.2 + (Math.floor(Math.random() * 8)) * 0.02;

                    // pt_slowgrav particle type
                    particle.userData.particleType = PT_SLOWGRAV;
                    particle.userData.fadeOut = true;

                    this.scene.add(particle);
                    this.particles.push(particle);
                }
            }
        }

        // Spawn a bright flash at the center
        this.spawnDynamicLight(position, {
            color: 0x00ffff,
            radius: 300,
            duration: 0.3,
            decay: 500
        });
    }

    /**
     * Spawn meat spray effect (combat.qc:SpawnMeatSpray)
     * Used by ogre chainsaw, shambler claws, demon melee
     * Sprays blood particles to the side
     *
     * @param {Object} position - Origin position {x, y, z}
     * @param {number} side - Side to spray (positive = right, negative = left)
     */
    spawnMeatSpray(position, side = 0) {
        // Spawn blood spray particles
        const particleCount = 8;
        for (let i = 0; i < particleCount; i++) {
            const particle = new THREE.Mesh(
                this.particleGeometry,
                new THREE.MeshBasicMaterial({
                    color: 0x880000,
                    transparent: true,
                    blending: THREE.AdditiveBlending,
                    depthWrite: false,
                    map: this.particleTexture
                })
            );

            particle.position.set(
                position.x + (Math.random() * 8 - 4),
                position.y + (Math.random() * 8 - 4),
                position.z + 16 + (Math.random() * 8)
            );
            particle.scale.setScalar(1.2);

            // Spray mostly sideways and up
            const baseAngle = side > 0 ? 0 : Math.PI;
            const angle = baseAngle + (Math.random() - 0.5) * 0.5;
            const speed = 150 + Math.random() * 100;

            particle.userData.velocity = {
                x: Math.cos(angle) * speed,
                y: Math.sin(angle) * speed,
                z: 100 + Math.random() * 100
            };

            particle.userData.life = 0.5 + Math.random() * 0.5;
            particle.userData.particleType = PT_GRAV;
            particle.userData.fadeOut = true;

            this.scene.add(particle);
            this.particles.push(particle);
        }
    }

    /**
     * Gib explosion effect (when entity is killed with health < -40)
     * Original: ThrowGib from player.qc / client.qc
     *
     * Spawns meat chunks that fly outward, bounce, and leave blood trails.
     * Head gib typically uses a specific model, body gibs use generic chunks.
     *
     * @param {Object} position - Origin position {x, y, z}
     * @param {number} velocity - Base throw velocity (scaled by damage)
     * @param {Object} game - Game reference for spawning gib entities
     * @param {string} headGibModel - Optional head gib model path
     */
    spawnGibs(position, velocity = 200, game = null, headGibModel = null) {
        // Number of gib chunks (original Quake spawns about 3-5)
        const gibCount = 3 + Math.floor(Math.random() * 3);

        // Spawn particles for blood spray (immediate visual feedback)
        // Original uses 10 blood particles per gib
        for (let i = 0; i < gibCount * 10; i++) {
            const particle = new THREE.Mesh(
                this.particleGeometry,
                new THREE.MeshBasicMaterial({
                    color: 0x880000,
                    transparent: true,
                    blending: THREE.AdditiveBlending,
                    depthWrite: false,
                    map: this.particleTexture
                })
            );

            // Scatter around origin
            particle.position.set(
                position.x + (Math.random() * 32 - 16),
                position.y + (Math.random() * 32 - 16),
                position.z + (Math.random() * 32 - 16)
            );
            particle.scale.setScalar(1.5);

            // Outward velocity with upward bias
            const speed = velocity * (0.5 + Math.random() * 0.5);
            const angle = Math.random() * Math.PI * 2;
            particle.userData.velocity = {
                x: Math.cos(angle) * speed * 0.5,
                y: Math.sin(angle) * speed * 0.5,
                z: speed * (0.3 + Math.random() * 0.7)
            };

            particle.userData.life = 1.0 + Math.random() * 1.0;
            particle.userData.particleType = PT_GRAV;
            particle.userData.fadeOut = true;

            this.scene.add(particle);
            this.particles.push(particle);
        }

        // If game is provided, spawn actual gib entities that can be rendered
        if (game && game.entities && game.renderer) {
            // Spawn head gib if model provided
            if (headGibModel) {
                this.spawnGibEntity(position, velocity * 1.5, game, headGibModel);
            }

            // Spawn body gibs (gib1, gib2, gib3)
            for (let i = 0; i < gibCount; i++) {
                const gibModel = `progs/gib${1 + (i % 3)}.mdl`;
                this.spawnGibEntity(position, velocity, game, gibModel);
            }
        }

        // Play gib sound
        // Original: misc/udeath.wav for player, zombie/z_gib.wav for zombies
        if (game && game.audio) {
            game.audio.playPositioned('sound/player/udeath.wav', position, 1.0, 1.0);
        }

        // Blood splash dynamic light (brief red flash)
        this.spawnDynamicLight(position, {
            color: 0x880000,
            radius: 100,
            duration: 0.2,
            decay: 200
        });
    }

    /**
     * Spawn a single gib entity with physics
     * @param {Object} position - Start position
     * @param {number} velocity - Base velocity
     * @param {Object} game - Game reference
     * @param {string} modelPath - Path to gib model
     */
    spawnGibEntity(position, velocity, game, modelPath) {
        // Create gib entity
        const gib = {
            classname: 'gib',
            category: 'debris',
            position: {
                x: position.x + (Math.random() * 16 - 8),
                y: position.y + (Math.random() * 16 - 8),
                z: position.z + (Math.random() * 16 - 8)
            },
            angles: {
                pitch: Math.random() * 360,
                yaw: Math.random() * 360,
                roll: Math.random() * 360
            },
            velocity: {
                x: (Math.random() - 0.5) * velocity * 2,
                y: (Math.random() - 0.5) * velocity * 2,
                z: velocity * (0.5 + Math.random())
            },
            // Angular velocity for tumbling
            angularVelocity: {
                pitch: (Math.random() - 0.5) * 400,
                yaw: (Math.random() - 0.5) * 400,
                roll: (Math.random() - 0.5) * 400
            },
            solid: 'not',
            moveType: 'bounce',  // Gibs bounce
            model: modelPath,
            active: true,
            data: {
                removeTime: game.time + 10.0 + Math.random() * 5.0,  // Despawn after 10-15 seconds
                lastTrailTime: 0
            }
        };

        // Add to game entities
        game.entities.add(gib);

        // Load and add model to scene
        if (game.renderer && game.renderer.aliasRenderer) {
            game.renderer.loadAndAddModel(gib, modelPath, this.scene).catch(e => {
                console.warn(`Failed to load gib model ${modelPath}:`, e);
            });
        }

        // Add physics
        if (game.physics) {
            game.physics.addEntity(gib);
        }

        // Set think function for blood trail and cleanup
        gib.think = (g, gameRef) => {
            // Spawn blood trail while moving
            if (g.velocity && (Math.abs(g.velocity.x) > 10 || Math.abs(g.velocity.y) > 10 || Math.abs(g.velocity.z) > 10)) {
                if (gameRef.time - g.data.lastTrailTime > 0.05) {
                    this.blood(g.position, 1);
                    g.data.lastTrailTime = gameRef.time;
                }
            }

            // Update rotation from angular velocity
            if (g.angularVelocity) {
                const dt = gameRef.deltaTime || 0.016;
                g.angles.pitch += g.angularVelocity.pitch * dt;
                g.angles.yaw += g.angularVelocity.yaw * dt;
                g.angles.roll += g.angularVelocity.roll * dt;

                // Dampen angular velocity over time
                g.angularVelocity.pitch *= 0.98;
                g.angularVelocity.yaw *= 0.98;
                g.angularVelocity.roll *= 0.98;
            }

            // Check for removal
            if (gameRef.time >= g.data.removeTime) {
                if (g.mesh && gameRef.renderer) {
                    gameRef.renderer.removeFromScene(g.mesh);
                }
                if (gameRef.physics) {
                    gameRef.physics.removeEntity(g);
                }
                gameRef.entities.remove(g);
            } else {
                g.nextThink = gameRef.time + 0.05;
            }
        };
        gib.nextThink = game.time + 0.05;

        return gib;
    }

    clear() {
        // Remove all effects
        for (const particle of this.particles) {
            this.scene.remove(particle);
            if (particle.geometry) particle.geometry.dispose();
            if (particle.material) particle.material.dispose();
        }
        this.particles = [];

        for (const flash of this.muzzleFlashes) {
            this.scene.remove(flash);
            if (flash.material) flash.material.dispose();
            if (flash.geometry) flash.geometry.dispose();
        }
        this.muzzleFlashes = [];

        for (const light of this.dynamicLights) {
            this.scene.remove(light);
            light.dispose();
        }
        this.dynamicLights = [];
    }
}
