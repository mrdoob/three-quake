import * as THREE from 'three';
import { indexedToRGBA, QUAKE_PALETTE } from '../loaders/Palette.js';

/**
 * SkyRenderer - Renders Quake sky (scrolling cloud layers)
 *
 * Quake sky textures are 256x128:
 * - Left half (0-127): foreground/alpha layer (index 0 = transparent)
 * - Right half (128-255): background/solid layer
 *
 * Original Quake renders sky by projecting UVs based on view direction,
 * with the dome flattened by multiplying Z by 3.
 */

const skyVertexShader = `
varying vec3 vWorldPosition;

void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const skyFragmentShader = `
uniform sampler2D backTexture;
uniform sampler2D frontTexture;
uniform float time;
uniform vec3 cameraPos;

varying vec3 vWorldPosition;

void main() {
    // Calculate direction from camera to sky vertex
    vec3 dir = vWorldPosition - cameraPos;

    // Flatten the dome (original Quake multiplies Z by 3)
    dir.z *= 3.0;

    // Normalize and scale (original: 6*63/length)
    float len = length(dir);
    float scale = 378.0 / len; // 6 * 63 = 378

    dir.x *= scale;
    dir.y *= scale;

    // Calculate UVs with scroll
    // Background scrolls at speed 8, foreground at speed 16
    float backSpeed = time * 8.0;
    float frontSpeed = time * 16.0;

    // Wrap speed to 0-128 range like original
    backSpeed = mod(backSpeed, 128.0);
    frontSpeed = mod(frontSpeed, 128.0);

    vec2 backUV = vec2((backSpeed + dir.x) / 128.0, (backSpeed + dir.y) / 128.0);
    vec2 frontUV = vec2((frontSpeed + dir.x) / 128.0, (frontSpeed + dir.y) / 128.0);

    // Sample textures
    vec4 backColor = texture2D(backTexture, backUV);
    vec4 frontColor = texture2D(frontTexture, frontUV);

    // Blend front over back using front's alpha
    vec3 finalColor = mix(backColor.rgb, frontColor.rgb, frontColor.a);

    gl_FragColor = vec4(finalColor, 1.0);

    #include <tonemapping_fragment>
}
`;

export class SkyRenderer {
    constructor(bsp, pak, skyTextureName) {
        this.bsp = bsp;
        this.pak = pak;
        this.skyTextureName = skyTextureName;
        this.time = 0;

        // Find sky texture in BSP
        this.skyTexture = null;
        for (const tex of bsp.textures) {
            if (tex && tex.name.toLowerCase() === skyTextureName.toLowerCase()) {
                this.skyTexture = tex;
                break;
            }
        }

        // Create sky textures
        this.frontTexture = null;
        this.backTexture = null;
        this.material = null;

        if (this.skyTexture && this.skyTexture.data) {
            this.createSkyTextures();
        }
    }

    createSkyTextures() {
        const tex = this.skyTexture;
        const halfWidth = tex.width / 2; // 128

        // Split texture into two halves
        // Left half (0-127) = foreground/alpha layer
        // Right half (128-255) = background/solid layer
        const frontData = new Uint8Array(halfWidth * tex.height);
        const backData = new Uint8Array(halfWidth * tex.height);

        // Calculate average color of background for transparency replacement
        let r = 0, g = 0, b = 0;
        let count = 0;

        for (let y = 0; y < tex.height; y++) {
            for (let x = 0; x < halfWidth; x++) {
                const srcIdx = y * tex.width + x;
                const srcIdxBack = y * tex.width + x + halfWidth;
                const dstIdx = y * halfWidth + x;

                // Front = left half (foreground with transparency)
                frontData[dstIdx] = tex.data[srcIdx];

                // Back = right half (solid background)
                backData[dstIdx] = tex.data[srcIdxBack];

                // Accumulate background colors for average
                const palIdx = backData[dstIdx] * 3;
                r += QUAKE_PALETTE[palIdx];
                g += QUAKE_PALETTE[palIdx + 1];
                b += QUAKE_PALETTE[palIdx + 2];
                count++;
            }
        }

        // Average background color
        const avgR = Math.floor(r / count);
        const avgG = Math.floor(g / count);
        const avgB = Math.floor(b / count);

        // Create RGBA textures
        const frontRGBA = indexedToRGBA(frontData, halfWidth, tex.height);
        const backRGBA = indexedToRGBA(backData, halfWidth, tex.height);

        // Make index 0 transparent in front layer
        // Original Quake replaces with average color but we use alpha blending
        for (let i = 0; i < frontData.length; i++) {
            if (frontData[i] === 0) {
                frontRGBA[i * 4 + 0] = avgR;
                frontRGBA[i * 4 + 1] = avgG;
                frontRGBA[i * 4 + 2] = avgB;
                frontRGBA[i * 4 + 3] = 0; // Transparent
            }
        }

        // Create Three.js textures with LINEAR filtering (like original)
        this.backTexture = new THREE.DataTexture(
            backRGBA,
            halfWidth,
            tex.height,
            THREE.RGBAFormat
        );
        this.backTexture.wrapS = THREE.RepeatWrapping;
        this.backTexture.wrapT = THREE.RepeatWrapping;
        this.backTexture.magFilter = THREE.LinearFilter;
        this.backTexture.minFilter = THREE.LinearFilter;
        this.backTexture.needsUpdate = true;

        this.frontTexture = new THREE.DataTexture(
            frontRGBA,
            halfWidth,
            tex.height,
            THREE.RGBAFormat
        );
        this.frontTexture.wrapS = THREE.RepeatWrapping;
        this.frontTexture.wrapT = THREE.RepeatWrapping;
        this.frontTexture.magFilter = THREE.LinearFilter;
        this.frontTexture.minFilter = THREE.LinearFilter;
        this.frontTexture.needsUpdate = true;

        // Create shader material
        this.material = new THREE.ShaderMaterial({
            uniforms: {
                backTexture: { value: this.backTexture },
                frontTexture: { value: this.frontTexture },
                time: { value: 0 },
                cameraPos: { value: new THREE.Vector3() }
            },
            vertexShader: skyVertexShader,
            fragmentShader: skyFragmentShader,
            side: THREE.BackSide,
            depthWrite: false
        });
    }

    createMesh() {
        if (!this.material) {
            this.skyGroup = new THREE.Group();
            return this.skyGroup;
        }

        // Create sky dome (large sphere)
        const radius = 4096;
        const geometry = new THREE.SphereGeometry(radius, 32, 16);

        // Rotate geometry so poles align with Z axis (Quake uses Z-up)
        geometry.rotateX(Math.PI / 2);

        const mesh = new THREE.Mesh(geometry, this.material);
        mesh.name = 'sky';

        this.skyMesh = mesh;
        return mesh;
    }

    update(deltaTime, camera) {
        this.time += deltaTime;

        if (this.material) {
            this.material.uniforms.time.value = this.time;

            if (camera) {
                this.material.uniforms.cameraPos.value.copy(camera.position);
            }
        }

        // Keep sky centered on camera
        if (this.skyMesh && camera) {
            this.skyMesh.position.copy(camera.position);
        }
    }
}
