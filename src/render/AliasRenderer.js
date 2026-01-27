import * as THREE from 'three';
import { MDLLoader, MDL_NORMALS } from '../loaders/MDLLoader.js';

/**
 * AliasRenderer - Renders Quake MDL (Alias) models
 */
export class AliasRenderer {
    constructor(pak) {
        this.pak = pak;
        this.modelCache = new Map();
        this.textureCache = new Map();
    }

    async loadModel(name) {
        // Check cache
        if (this.modelCache.has(name)) {
            return this.modelCache.get(name);
        }

        // Load MDL file from PAK
        const mdlData = this.pak.get(name);
        if (!mdlData) {
            console.warn(`Model not found: ${name}`);
            return null;
        }

        const loader = new MDLLoader();
        const mdl = loader.load(mdlData);

        // Create Three.js resources
        const modelData = {
            mdl: mdl,
            geometry: this.createGeometry(mdl),
            texture: this.createTexture(mdl),
            animations: this.parseAnimations(mdl)
        };

        this.modelCache.set(name, modelData);
        return modelData;
    }

    /**
     * Get a cached model (returns null if not loaded)
     * Used by demo playback to check model flags for trails/effects
     * @param {string} name - Model path (e.g., "progs/missile.mdl")
     * @returns {Object|null} Model data with mdl.header.flags, or null if not loaded
     */
    getModel(name) {
        return this.modelCache.get(name) || null;
    }

    /**
     * Get model flags from cached model
     * @param {string} name - Model path
     * @returns {number} Model flags, or 0 if not loaded
     */
    getModelFlags(name) {
        const modelData = this.modelCache.get(name);
        if (modelData && modelData.mdl && modelData.mdl.header) {
            return modelData.mdl.header.flags;
        }
        return 0;
    }

    createGeometry(mdl) {
        // Get first frame vertices
        const frame = mdl.getFrame(0);
        const vertices = mdl.getFrameVertices(0);

        const positions = [];
        const normals = [];
        const uvs = [];

        // Build triangles
        // Quake uses clockwise winding with glCullFace(GL_FRONT)
        // Three.js uses counter-clockwise with back-face culling
        // So we reverse the winding order: 0, 2, 1 instead of 0, 1, 2
        const windingOrder = [0, 2, 1];
        for (const tri of mdl.triangles) {
            for (let i = 0; i < 3; i++) {
                const vertIndex = tri.indices[windingOrder[i]];
                const vertex = vertices[vertIndex];
                const texcoord = mdl.texcoords[vertIndex];
                const frameVert = frame.vertices[vertIndex];

                // Position
                positions.push(vertex.x, vertex.y, vertex.z);

                // Normal from lookup table
                const normal = MDL_NORMALS[frameVert.normalIndex] || [0, 0, 1];
                normals.push(normal[0], normal[1], normal[2]);

                // Texture coordinates
                let s = texcoord.s;
                let t = texcoord.t;

                // Back-facing triangles need seam adjustment
                if (!tri.frontFacing && texcoord.onseam) {
                    s += 0.5;
                }

                uvs.push(s, t);
            }
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));

        return geometry;
    }

    createTexture(mdl) {
        if (mdl.skins.length === 0) {
            return this.createFallbackTexture();
        }

        const skinRGBA = mdl.getSkinRGBA(0);
        const texture = new THREE.DataTexture(
            skinRGBA,
            mdl.header.skinWidth,
            mdl.header.skinHeight,
            THREE.RGBAFormat
        );

        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        // No flipY - Quake's UV system combined with texture storage means no flip needed
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.needsUpdate = true;

        return texture;
    }

    createFallbackTexture() {
        const size = 32;
        const data = new Uint8Array(size * size * 4);

        for (let i = 0; i < data.length; i += 4) {
            data[i] = 128;
            data[i + 1] = 128;
            data[i + 2] = 128;
            data[i + 3] = 255;
        }

        const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
        texture.needsUpdate = true;
        return texture;
    }

    /**
     * Set texture filtering mode for all loaded model textures
     * @param {boolean} smooth - true for linear filtering, false for nearest (pixelated)
     */
    setTextureFiltering(smooth) {
        const filter = smooth ? THREE.LinearFilter : THREE.NearestFilter;

        // Update all cached model textures
        for (const modelData of this.modelCache.values()) {
            if (modelData.texture) {
                modelData.texture.magFilter = filter;
                modelData.texture.minFilter = filter;
                modelData.texture.needsUpdate = true;
            }
        }
    }

    parseAnimations(mdl) {
        const animations = {};

        // Group frames by name prefix
        for (let i = 0; i < mdl.frames.length; i++) {
            const frameData = mdl.frames[i];
            let frame;

            if (frameData.type === 'single') {
                frame = frameData.frame;
            } else {
                // Frame group - use first frame for naming
                frame = frameData.frames[0];
            }

            // Parse animation name from frame name (e.g., "run1" -> "run")
            // Handles underscore names: "w_attack1" -> "w_attack", "prowl_1" -> "prowl_"
            const match = frame.name.match(/^([a-zA-Z][a-zA-Z_]*)(\d*)$/);
            if (match) {
                const animName = match[1];
                if (!animations[animName]) {
                    animations[animName] = {
                        frames: [],
                        startFrame: i
                    };
                }
                animations[animName].frames.push(i);
            }
        }

        return animations;
    }

    createInstance(modelData) {
        if (!modelData) return null;

        // Use MeshBasicMaterial with modifiable color for shading
        // Original Quake: r_shadelight and r_ambientlight affect model brightness
        const material = new THREE.MeshBasicMaterial({
            map: modelData.texture,
            side: THREE.FrontSide,
            color: 0xffffff  // Will be modified based on light sampling
        });

        // Clone geometry for this instance (needed for animation)
        const geometry = modelData.geometry.clone();

        const mesh = new THREE.Mesh(geometry, material);

        // Attach model data for animation
        mesh.userData.modelData = modelData;
        mesh.userData.currentFrame = 0;
        mesh.userData.animationTime = 0;
        mesh.userData.currentAnimation = null;
        mesh.userData.animationLoop = true;
        mesh.userData.animationFinished = false;
        mesh.userData.shadeLight = 1.0;  // Current light level

        return mesh;
    }

    /**
     * Update model shading based on position (R_SetupAliasFrame lighting)
     * Original Quake samples light at model position using R_LightPoint
     *
     * @param {THREE.Mesh} mesh - The model mesh
     * @param {number} lightLevel - Light intensity (0.0 to 1.0) from BSPRenderer.lightPoint
     */
    updateShading(mesh, lightLevel) {
        if (!mesh || !mesh.material) return;

        mesh.userData.shadeLight = lightLevel;

        // Apply shading by modifying material color
        // In original Quake, this affects the texture brightness
        // Using a minimum of 0.2 for r_ambient equivalent
        const shade = Math.max(0.2, Math.min(1.0, lightLevel));

        // Convert to hex color (grayscale for lighting)
        const intensity = Math.floor(shade * 255);
        mesh.material.color.setRGB(shade, shade, shade);
    }

    updateAnimation(mesh, deltaTime) {
        const userData = mesh.userData;
        const modelData = userData.modelData;

        if (!modelData || !userData.currentAnimation) return;

        // Skip if animation is finished (non-looping)
        if (userData.animationFinished) return;

        const mdl = modelData.mdl;
        const anim = modelData.animations[userData.currentAnimation];

        if (!anim) return;

        // Update animation time
        userData.animationTime += deltaTime;

        // Calculate frame with interpolation (10 fps)
        const frameRate = 10;
        const animTime = userData.animationTime * frameRate;
        let frameIndex = Math.floor(animTime);
        let nextFrameIndex = frameIndex + 1;
        let t = animTime - frameIndex; // Interpolation factor 0-1

        // Handle looping vs non-looping animations
        if (userData.animationLoop) {
            frameIndex = frameIndex % anim.frames.length;
            nextFrameIndex = nextFrameIndex % anim.frames.length;
        } else {
            // Clamp to last frame for non-looping animations
            if (frameIndex >= anim.frames.length - 1) {
                frameIndex = anim.frames.length - 1;
                nextFrameIndex = frameIndex;
                t = 0;
                userData.animationFinished = true;
            }
        }

        const frame1 = anim.frames[frameIndex];
        const frame2 = anim.frames[nextFrameIndex];

        // Interpolate between frames for smooth animation
        this.interpolateFrames(mesh, frame1, frame2, t);
        userData.currentFrame = frame1;
    }

    /**
     * Set model to a specific frame
     * @param {THREE.Mesh} mesh - The model mesh
     * @param {number} frameIndex - Frame index
     * @param {number} time - Current time for frame group animation (optional)
     */
    setFrame(mesh, frameIndex, time = 0) {
        const modelData = mesh.userData.modelData;
        const mdl = modelData.mdl;

        const vertices = mdl.getFrameVertices(frameIndex, time);
        const frame = mdl.getFrame(frameIndex, time);

        const positions = mesh.geometry.attributes.position.array;
        const normals = mesh.geometry.attributes.normal.array;

        // Same winding order as createGeometry
        const windingOrder = [0, 2, 1];
        let vertexIndex = 0;
        for (const tri of mdl.triangles) {
            for (let i = 0; i < 3; i++) {
                const vIdx = tri.indices[windingOrder[i]];
                const vertex = vertices[vIdx];
                const frameVert = frame.vertices[vIdx];

                // Update position
                positions[vertexIndex * 3] = vertex.x;
                positions[vertexIndex * 3 + 1] = vertex.y;
                positions[vertexIndex * 3 + 2] = vertex.z;

                // Update normal
                const normal = MDL_NORMALS[frameVert.normalIndex] || [0, 0, 1];
                normals[vertexIndex * 3] = normal[0];
                normals[vertexIndex * 3 + 1] = normal[1];
                normals[vertexIndex * 3 + 2] = normal[2];

                vertexIndex++;
            }
        }

        mesh.geometry.attributes.position.needsUpdate = true;
        mesh.geometry.attributes.normal.needsUpdate = true;
    }

    setAnimation(mesh, animationName, loop = true) {
        if (mesh.userData.currentAnimation !== animationName) {
            mesh.userData.currentAnimation = animationName;
            mesh.userData.animationTime = 0;
            mesh.userData.animationLoop = loop;
            mesh.userData.animationFinished = false;
        }
    }

    /**
     * Interpolate between two frames
     *
     * Note: Original Quake does NOT interpolate normals - it uses the current
     * frame's normal for lighting calculations. This matches that behavior.
     * (See R_AliasFrameSetup in r_alias.c)
     */
    interpolateFrames(mesh, frame1, frame2, t) {
        const modelData = mesh.userData.modelData;
        const mdl = modelData.mdl;

        const vertices1 = mdl.getFrameVertices(frame1);
        const vertices2 = mdl.getFrameVertices(frame2);
        // Use current frame's normals (no interpolation, like original Quake)
        const frameData1 = mdl.getFrame(frame1);

        const positions = mesh.geometry.attributes.position.array;
        const normals = mesh.geometry.attributes.normal.array;

        // Same winding order as createGeometry
        const windingOrder = [0, 2, 1];
        let vertexIndex = 0;
        for (const tri of mdl.triangles) {
            for (let i = 0; i < 3; i++) {
                const vIdx = tri.indices[windingOrder[i]];
                const v1 = vertices1[vIdx];
                const v2 = vertices2[vIdx];

                // Lerp position
                positions[vertexIndex * 3] = v1.x + (v2.x - v1.x) * t;
                positions[vertexIndex * 3 + 1] = v1.y + (v2.y - v1.y) * t;
                positions[vertexIndex * 3 + 2] = v1.z + (v2.z - v1.z) * t;

                // Use current frame's normal only (no interpolation, like original Quake)
                const n1 = MDL_NORMALS[frameData1.vertices[vIdx].normalIndex] || [0, 0, 1];
                normals[vertexIndex * 3] = n1[0];
                normals[vertexIndex * 3 + 1] = n1[1];
                normals[vertexIndex * 3 + 2] = n1[2];

                vertexIndex++;
            }
        }

        mesh.geometry.attributes.position.needsUpdate = true;
        mesh.geometry.attributes.normal.needsUpdate = true;
    }
}
