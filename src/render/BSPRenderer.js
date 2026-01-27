import * as THREE from 'three';
import { indexedToRGBA, QUAKE_PALETTE } from '../loaders/Palette.js';
import { WADLoader } from '../loaders/WADLoader.js';
import { LightmapBuilder } from './LightmapBuilder.js';
import { createLightmapMaterial, updateDynamicLights } from './LightmapMaterial.js';

/**
 * BSPRenderer - Converts BSP data to Three.js geometry
 */
export class BSPRenderer {
    constructor(bsp, pak) {
        this.bsp = bsp;
        this.pak = pak;
        this.textures = new Map();
        this.textureDimensions = new Map(); // Store actual texture dimensions per index
        this.materials = []; // Array indexed by texture index
        this.materialIndexMap = new Map(); // Map texture index to material array index
        this.lightmapAtlas = null;
        this.lightmapBuilder = null;
        this.animatedMaterials = [];
        this.waterMaterials = [];
        this.brushModelAnimations = new Map(); // modelIndex → [{materialIndex, primaryTextures[], altTextures[]}]
        this.time = 0;

        // Load WAD files for external textures
        this.wadLoaders = [];
        this.loadWADs();
    }

    loadWADs() {
        // Check worldspawn entity for WAD references
        const worldspawn = this.bsp.entities.find(e => e.classname === 'worldspawn');
        if (worldspawn && worldspawn.wad) {
            // WAD paths are semicolon-separated, can be full paths like "gfx/quake.wad"
            const wadPaths = worldspawn.wad.split(';').filter(p => p.trim());

            for (const wadPath of wadPaths) {
                // Extract just the filename
                const filename = wadPath.split(/[\/\\]/).pop().toLowerCase();

                // Try to find WAD in PAK
                const possiblePaths = [
                    filename,
                    `gfx/${filename}`,
                    wadPath.toLowerCase()
                ];

                for (const path of possiblePaths) {
                    const wadData = this.pak.get(path);
                    if (wadData) {
                        try {
                            const wadLoader = new WADLoader();
                            wadLoader.load(wadData);
                            this.wadLoaders.push(wadLoader);
                            console.log(`Loaded WAD: ${path}`);
                        } catch (e) {
                            console.warn(`Failed to load WAD ${path}:`, e);
                        }
                        break;
                    }
                }
            }
        }
    }

    createMesh() {
        // Create lightmap atlas FIRST (before materials need it)
        this.createLightmapAtlas();

        // Create textures and materials (uses lightmap atlas)
        this.createTextures();

        // Build geometry for model 0 (world model)
        const worldModel = this.bsp.models[0];
        const geometry = this.buildGeometry(worldModel.firstFace, worldModel.numFaces);

        // Create mesh with materials array
        const mesh = new THREE.Mesh(geometry, this.materials);
        mesh.name = 'bsp_world';

        return mesh;
    }

    createTextures() {
        // First pass: create all materials and build index map
        for (let i = 0; i < this.bsp.textures.length; i++) {
            const texData = this.bsp.textures[i];

            // Map this texture index to a material array index
            const materialIndex = this.materials.length;
            this.materialIndexMap.set(i, materialIndex);

            if (!texData) {
                // Null texture - create invisible material
                this.materials.push(new THREE.MeshBasicMaterial({ visible: false }));
                this.textureDimensions.set(i, { width: 64, height: 64 });
                continue;
            }

            // Check for special textures
            const name = texData.name.toLowerCase();
            const isAnimated = name.startsWith('+');
            const isWater = name.startsWith('*');
            const isSky = name.startsWith('sky');
            // Invisible textures: trigger, clip, skip, hint, nodraw, aaatrigger
            const isInvisible = name === 'trigger' || name === 'clip' ||
                                name === 'skip' || name === 'hint' ||
                                name === 'nodraw' || name === 'aaatrigger' ||
                                name.startsWith('trigger');

            if (isInvisible) {
                // Invisible brushes
                this.materials.push(new THREE.MeshBasicMaterial({
                    visible: false,
                    transparent: true,
                    opacity: 0
                }));
                this.textureDimensions.set(i, { width: texData.width || 64, height: texData.height || 64 });
                continue;
            }

            if (isSky) {
                // Sky is handled separately
                this.materials.push(new THREE.MeshBasicMaterial({
                    visible: false
                }));
                this.textureDimensions.set(i, { width: texData.width || 64, height: texData.height || 64 });
                continue;
            }

            // Convert indexed texture to RGBA
            let textureData = texData.data;
            let texWidth = texData.width;
            let texHeight = texData.height;

            if (!textureData) {
                // Try loading from WAD
                const wadTex = this.loadTextureFromWADWithDimensions(texData.name);
                if (wadTex) {
                    textureData = wadTex.data;
                    texWidth = wadTex.width;
                    texHeight = wadTex.height;
                }
            }

            let texture;

            if (textureData) {
                const rgba = indexedToRGBA(textureData, texWidth, texHeight);
                texture = new THREE.DataTexture(rgba, texWidth, texHeight, THREE.RGBAFormat);
                texture.wrapS = THREE.RepeatWrapping;
                texture.wrapT = THREE.RepeatWrapping;
                // Default: NearestFilter (pixelated). Configurable via gl_texturemode setting.
                texture.magFilter = THREE.NearestFilter;
                texture.minFilter = THREE.NearestFilter;
                // Don't use sRGB - Quake textures are linear and we handle lighting manually
                texture.needsUpdate = true;
            } else {
                // Fallback texture
                texture = this.createFallbackTexture();
                texWidth = 64;
                texHeight = 64;
            }

            this.textures.set(i, texture);
            // Store actual texture dimensions for UV calculation
            this.textureDimensions.set(i, { width: texWidth, height: texHeight });

            // Create material
            // Note: Original GLQuake did NOT implement per-pixel fullbright for BSP textures.
            // Software Quake handled it via colormap, but GLQuake just applied lightmaps
            // to everything. We match GLQuake behavior here.
            // (See gl_rmain.c:511 "HACK HACK HACK -- no fullbright colors")
            let material;
            if (isWater) {
                // Create water material with UV warping shader
                material = this.createWaterMaterial(texture, name);
                this.waterMaterials.push({
                    material,
                    originalOpacity: 0.7,
                    name
                });
                console.log(`Water texture loaded: ${name}, has data: ${!!textureData}`);
            } else if (this.lightmapAtlas) {
                // Use custom lightmap shader
                material = createLightmapMaterial(texture, this.lightmapAtlas, {
                    side: THREE.FrontSide,
                    lightMapIntensity: 2.0
                });
            } else {
                // Fallback to vertex colors if no lightmap
                material = new THREE.MeshBasicMaterial({
                    map: texture,
                    side: THREE.FrontSide,
                    vertexColors: true
                });
            }

            if (isAnimated) {
                // Find all frames for this animated texture sequence
                // Quake animated textures: +0name, +1name, +2name, ... or +aname, +bname
                const baseNameMatch = name.match(/^\+(\d|[a-z])(.+)$/);
                if (baseNameMatch) {
                    const sequenceName = baseNameMatch[2];
                    this.animatedMaterials.push({
                        index: i,
                        baseName: name,
                        sequenceName: sequenceName,
                        material: material,
                        frame: 0,
                        textures: [texture] // Will be populated with all frames
                    });
                }
            }

            this.materials.push(material);
        }
    }

    loadTextureFromWAD(name) {
        const result = this.loadTextureFromWADWithDimensions(name);
        return result ? result.data : null;
    }

    loadTextureFromWADWithDimensions(name) {
        // Try to find texture in loaded WADs
        const lowerName = name.toLowerCase();

        for (const wad of this.wadLoaders) {
            if (wad.has(lowerName)) {
                const tex = wad.get(lowerName);
                if (tex && tex.data) {
                    return {
                        data: tex.data,
                        width: tex.width,
                        height: tex.height
                    };
                }
            }
        }

        return null;
    }

    /**
     * Create water material with UV warping effect
     * Original Quake: R_DrawWaterSurfaces used sinusoidal UV displacement
     */
    createWaterMaterial(texture, name) {
        // Determine water type for color tint
        let tintColor = new THREE.Color(1, 1, 1);
        let baseOpacity = 0.7;

        const lowerName = name.toLowerCase();
        if (lowerName.includes('lava')) {
            tintColor = new THREE.Color(1.0, 0.5, 0.2); // Orange/red
            baseOpacity = 0.9;
        } else if (lowerName.includes('slime')) {
            tintColor = new THREE.Color(0.3, 0.8, 0.2); // Green
            baseOpacity = 0.8;
        } else {
            tintColor = new THREE.Color(0.6, 0.8, 1.0); // Blue tint
        }

        // Custom shader for water warping
        const material = new THREE.ShaderMaterial({
            uniforms: {
                map: { value: texture },
                time: { value: 0 },
                opacity: { value: baseOpacity },
                tint: { value: tintColor }
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D map;
                uniform float time;
                uniform float opacity;
                uniform vec3 tint;
                varying vec2 vUv;

                void main() {
                    // Original Quake water warp from gl_warp.c:210-214
                    // Formula: s = (os + turbsin[(ot*0.125+time) * TURBSCALE]) / 64
                    // turbsin values range -8 to 8, equivalent to 8*sin(x)
                    //
                    // Derived formula in UV space (64 texels = 1 UV unit):
                    // warpedU = vUv.x + (8/64) * sin(vUv.y * 64 * 0.125 + time)
                    //         = vUv.x + 0.125 * sin(vUv.y * 8 + time)
                    //
                    // Amplitude: 8/64 = 0.125 in UV space
                    // Spatial frequency: 8 radians per UV unit (from 64 * 0.125)
                    // Temporal frequency: 1 radian per second

                    float warpAmplitude = 0.125;  // 8/64 from original
                    float spatialFreq = 8.0;      // 64 * 0.125 from original
                    float timeFreq = 1.0;         // realtime coefficient

                    // Calculate UV displacement using original Quake formula
                    vec2 warpedUV = vUv;
                    warpedUV.x += sin(vUv.y * spatialFreq + time * timeFreq) * warpAmplitude;
                    warpedUV.y += sin(vUv.x * spatialFreq + time * timeFreq) * warpAmplitude;

                    vec4 texColor = texture2D(map, warpedUV);
                    texColor.rgb *= tint;
                    texColor.a *= opacity;

                    gl_FragColor = texColor;
                }
            `,
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false
        });

        material.userData.baseOpacity = baseOpacity;

        return material;
    }

    createFallbackTexture() {
        const size = 64;
        const data = new Uint8Array(size * size * 4);

        // Checkerboard pattern
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const i = (y * size + x) * 4;
                const checker = ((x >> 3) ^ (y >> 3)) & 1;
                const color = checker ? 255 : 128;
                data[i] = color;
                data[i + 1] = 0;
                data[i + 2] = color;
                data[i + 3] = 255;
            }
        }

        const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        // Default: NearestFilter (pixelated). Configurable via gl_texturemode setting.
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        texture.needsUpdate = true;

        return texture;
    }

    createLightmapAtlas() {
        if (!this.bsp.lighting) {
            console.log('No lighting data in BSP');
            return;
        }

        // Build lightmap atlas
        this.lightmapBuilder = new LightmapBuilder(this.bsp);
        this.lightmapAtlas = this.lightmapBuilder.build();

        if (this.lightmapAtlas) {
            console.log('Lightmap atlas built successfully');
        }
    }

    buildGeometry(firstFace, numFaces) {
        const positions = [];
        const normals = [];
        const uvs = [];
        const lightmapUvs = [];
        const colors = [];
        const groups = [];

        let vertexOffset = 0;

        // Group faces by texture
        const facesByTexture = new Map();

        for (let i = 0; i < numFaces; i++) {
            const faceIndex = firstFace + i;
            const face = this.bsp.faces[faceIndex];
            const texinfo = this.bsp.texinfo[face.texinfoNum];
            const textureIndex = texinfo.textureIndex;

            if (!facesByTexture.has(textureIndex)) {
                facesByTexture.set(textureIndex, []);
            }
            facesByTexture.get(textureIndex).push(faceIndex);
        }

        // Build geometry grouped by material
        for (const [textureIndex, faceIndices] of facesByTexture) {
            const groupStart = positions.length / 3;
            let groupVertexCount = 0;

            for (const faceIndex of faceIndices) {
                const vertCount = this.buildFace(
                    faceIndex,
                    positions,
                    normals,
                    uvs,
                    lightmapUvs,
                    colors
                );
                groupVertexCount += vertCount;
            }

            if (groupVertexCount > 0) {
                // Use the material index map to get correct array index
                const materialIndex = this.materialIndexMap.get(textureIndex) || 0;
                groups.push({
                    start: groupStart,
                    count: groupVertexCount,
                    materialIndex: materialIndex
                });
            }
        }

        // Create BufferGeometry
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));

        if (lightmapUvs.length > 0) {
            geometry.setAttribute('uv2', new THREE.Float32BufferAttribute(lightmapUvs, 2));
        }

        if (colors.length > 0) {
            geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        }

        // Set material groups
        for (const group of groups) {
            geometry.addGroup(group.start, group.count, group.materialIndex);
        }

        return geometry;
    }

    buildFace(faceIndex, positions, normals, uvs, lightmapUvs, colors) {
        const face = this.bsp.faces[faceIndex];
        const plane = this.bsp.planes[face.planeNum];
        const texinfo = this.bsp.texinfo[face.texinfoNum];
        const textureIndex = texinfo.textureIndex;

        // Get actual texture dimensions (may be from WAD)
        const texDims = this.textureDimensions.get(textureIndex) || { width: 64, height: 64 };

        // Get face vertices
        const faceVertices = this.bsp.getFaceVertices(faceIndex);
        if (faceVertices.length < 3) return 0;

        // Get plane normal
        let normal = plane.normal;
        if (face.side) {
            normal = { x: -normal.x, y: -normal.y, z: -normal.z };
        }

        // Calculate lightmap info
        const lightmapInfo = this.bsp.getFaceLightmapSize(faceIndex);

        // Calculate average light level for this face (fallback for vertex colors)
        let lightLevel = 1.0;
        if (this.bsp.lighting && face.lightmapOffset >= 0 && face.styles[0] !== 255) {
            const lightSize = lightmapInfo.width * lightmapInfo.height;
            let totalLight = 0;
            for (let i = 0; i < lightSize; i++) {
                const idx = face.lightmapOffset + i;
                if (idx < this.bsp.lighting.length) {
                    totalLight += this.bsp.lighting[idx];
                }
            }
            lightLevel = (totalLight / lightSize) / 255.0;
            // Original Quake applies gamma to display output, not lightmap data
            // Default gamma is 1.0 (linear). Use raw values for accuracy.
            lightLevel = Math.min(lightLevel, 1.0);
        }

        // Triangulate (fan from first vertex)
        // Reverse winding order: Quake uses clockwise, Three.js uses counter-clockwise
        let vertexCount = 0;
        for (let i = 1; i < faceVertices.length - 1; i++) {
            const v0 = faceVertices[0];
            const v1 = faceVertices[i + 1];  // Swapped with v2
            const v2 = faceVertices[i];      // Swapped with v1

            // Add positions
            positions.push(v0.x, v0.y, v0.z);
            positions.push(v1.x, v1.y, v1.z);
            positions.push(v2.x, v2.y, v2.z);

            // Add normals
            normals.push(normal.x, normal.y, normal.z);
            normals.push(normal.x, normal.y, normal.z);
            normals.push(normal.x, normal.y, normal.z);

            // Add texture UVs - calculate with actual dimensions
            for (const v of [v0, v1, v2]) {
                const s = texinfo.s;
                const t = texinfo.t;
                const u = (v.x * s.x + v.y * s.y + v.z * s.z + s.offset) / texDims.width;
                const uv_v = (v.x * t.x + v.y * t.y + v.z * t.z + t.offset) / texDims.height;
                uvs.push(u, uv_v);
            }

            // Add lightmap UVs
            if (this.lightmapBuilder && this.lightmapBuilder.hasLightmap(faceIndex)) {
                // Use proper atlas UVs
                for (const v of [v0, v1, v2]) {
                    const lmUV = this.lightmapBuilder.getLightmapUV(faceIndex, v, texinfo);
                    lightmapUvs.push(lmUV.u, lmUV.v);
                }
            } else {
                // No lightmap - use default UVs
                for (const v of [v0, v1, v2]) {
                    lightmapUvs.push(0.5, 0.5);
                }
            }

            // Add vertex colors (fallback lighting when no lightmap shader)
            for (let j = 0; j < 3; j++) {
                colors.push(lightLevel, lightLevel, lightLevel);
            }

            vertexCount += 3;
        }

        return vertexCount;
    }

    createBrushModelMesh(modelIndex, externalBsp = null) {
        const bsp = externalBsp || this.bsp;

        if (modelIndex < 0 || modelIndex >= bsp.models.length) {
            return null;
        }

        const model = bsp.models[modelIndex];

        // For external BSP (item models), we need to build geometry differently
        if (externalBsp) {
            const result = this.buildExternalBspGeometry(externalBsp, model);
            if (!result) return null;

            const { geometry, material } = result;
            const mesh = new THREE.Mesh(geometry, material);
            mesh.name = `item_model_${modelIndex}`;
            return mesh;
        }

        const geometry = this.buildGeometry(model.firstFace, model.numFaces);

        // Check if this brush model uses any animated textures.
        // If so, clone those materials so we can switch between primary/alternate
        // sequences per-entity (for buttons etc.) without affecting the world.
        const animatedFaceMaterials = this.findAnimatedMaterialsForModel(model);

        let materials;
        if (animatedFaceMaterials.length > 0) {
            // Clone the entire materials array so this mesh has independent materials
            materials = this.materials.map(m => m);
            const animInfos = [];

            for (const info of animatedFaceMaterials) {
                // Clone the material for this brush model.
                // ShaderMaterial.clone() shares uniforms by reference,
                // so we must deep-clone uniforms for independent texture control.
                const cloned = info.material.clone();
                if (info.material.isShaderMaterial && info.material.uniforms) {
                    cloned.uniforms = THREE.UniformsUtils.clone(info.material.uniforms);
                }
                materials[info.materialArrayIndex] = cloned;

                animInfos.push({
                    materialArrayIndex: info.materialArrayIndex,
                    clonedMaterial: cloned,
                    primaryTextures: info.primaryTextures,
                    altTextures: info.altTextures,
                    showingAlt: false
                });
            }

            this.brushModelAnimations.set(modelIndex, animInfos);
        } else {
            materials = this.materials;
        }

        const mesh = new THREE.Mesh(geometry, materials);
        mesh.name = `bsp_model_${modelIndex}`;
        mesh.userData.brushModelIndex = modelIndex;

        // NOTE: Do NOT set position from model.origin here!
        // In Quake, brush model vertices are stored in world coordinates.
        // The entity's origin (from protocol) is the TRANSLATION to apply.
        // model.origin is just the bounding box center for rotation, not for positioning.
        // The position will be set by syncDemoEntitiesToVisuals from entity origin.

        return mesh;
    }

    buildExternalBspGeometry(bsp, model) {
        const positions = [];
        const normals = [];
        const uvs = [];

        // Extract first texture from the BSP textures lump for material
        let material = new THREE.MeshBasicMaterial({ color: 0x888888 }); // fallback
        if (bsp.textures && bsp.textures.length > 0) {
            const tex = bsp.textures[0];
            if (tex && tex.width > 0 && tex.height > 0 && tex.data) {
                // Convert indexed texture to RGBA
                const rgba = new Uint8Array(tex.width * tex.height * 4);
                for (let i = 0; i < tex.data.length; i++) {
                    const colorIndex = tex.data[i];
                    const paletteIndex = colorIndex * 3;
                    rgba[i * 4] = QUAKE_PALETTE[paletteIndex];
                    rgba[i * 4 + 1] = QUAKE_PALETTE[paletteIndex + 1];
                    rgba[i * 4 + 2] = QUAKE_PALETTE[paletteIndex + 2];
                    rgba[i * 4 + 3] = 255;
                }

                const texture = new THREE.DataTexture(rgba, tex.width, tex.height, THREE.RGBAFormat);
                texture.wrapS = THREE.RepeatWrapping;
                texture.wrapT = THREE.RepeatWrapping;
                // Default: NearestFilter (pixelated). Configurable via gl_texturemode setting.
                texture.magFilter = THREE.NearestFilter;
                texture.minFilter = THREE.NearestFilter;
                texture.colorSpace = THREE.SRGBColorSpace;
                texture.needsUpdate = true;

                material = new THREE.MeshBasicMaterial({
                    map: texture,
                    side: THREE.DoubleSide
                });
            }
        }

        // Get texture dimensions for UV calculation
        let texWidth = 64, texHeight = 64;
        if (bsp.textures && bsp.textures[0]) {
            texWidth = bsp.textures[0].width || 64;
            texHeight = bsp.textures[0].height || 64;
        }

        // Build faces from external BSP
        for (let i = 0; i < model.numFaces; i++) {
            const faceIndex = model.firstFace + i;
            if (faceIndex >= bsp.faces.length) continue;

            const face = bsp.faces[faceIndex];
            const texInfo = bsp.texinfo[face.texinfoNum];
            const plane = bsp.planes[face.planeId];

            if (!texInfo || !plane) continue;

            // Get normal (flip if back-facing)
            let nx = plane.normal.x;
            let ny = plane.normal.y;
            let nz = plane.normal.z;
            if (face.side) {
                nx = -nx;
                ny = -ny;
                nz = -nz;
            }

            // Build triangles from edge loop
            const vertices = [];
            for (let e = 0; e < face.numEdges; e++) {
                const edgeIndex = bsp.surfedges[face.firstEdge + e];
                const edge = bsp.edges[Math.abs(edgeIndex)];
                const vertIndex = edgeIndex >= 0 ? edge.v[0] : edge.v[1];
                vertices.push(bsp.vertices[vertIndex]);
            }

            // Fan triangulation
            for (let t = 1; t < vertices.length - 1; t++) {
                const v0 = vertices[0];
                const v1 = vertices[t];
                const v2 = vertices[t + 1];

                positions.push(v0.x, v0.y, v0.z);
                positions.push(v1.x, v1.y, v1.z);
                positions.push(v2.x, v2.y, v2.z);

                normals.push(nx, ny, nz);
                normals.push(nx, ny, nz);
                normals.push(nx, ny, nz);

                // Calculate UVs (normalized to texture size)
                // texInfo has s and t with x, y, z, offset properties
                const calcUV = (v) => {
                    const s = (v.x * texInfo.s.x + v.y * texInfo.s.y + v.z * texInfo.s.z + texInfo.s.offset) / texWidth;
                    const t = (v.x * texInfo.t.x + v.y * texInfo.t.y + v.z * texInfo.t.z + texInfo.t.offset) / texHeight;
                    return [s, t];
                };

                const uv0 = calcUV(v0);
                const uv1 = calcUV(v1);
                const uv2 = calcUV(v2);

                uvs.push(uv0[0], uv0[1]);
                uvs.push(uv1[0], uv1[1]);
                uvs.push(uv2[0], uv2[1]);
            }
        }

        if (positions.length === 0) return null;

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));

        return { geometry, material };
    }

    update(deltaTime) {
        this.time += deltaTime;

        // Animate water (update shader uniforms)
        for (const water of this.waterMaterials) {
            if (water.material.uniforms) {
                // Shader material - update time for UV warping
                water.material.uniforms.time.value = this.time;
                // Subtle opacity pulse
                const baseOpacity = water.material.userData.baseOpacity || water.originalOpacity;
                water.material.uniforms.opacity.value = baseOpacity + Math.sin(this.time * 2) * 0.05;
            } else {
                // Basic material fallback
                water.material.opacity = water.originalOpacity + Math.sin(this.time * 2) * 0.1;
            }
        }

        // Animate textures (frame cycling at ~5 fps like Quake)
        for (const anim of this.animatedMaterials) {
            // Build texture list for this sequence if not done yet
            if (anim.textures.length === 1 && anim.sequenceName) {
                this.buildAnimatedTextureSequence(anim);
            }

            if (anim.textures.length > 1) {
                // Quake animated textures cycle at ~5 fps
                const frameIndex = Math.floor(this.time * 5) % anim.textures.length;
                if (frameIndex !== anim.frame) {
                    anim.frame = frameIndex;
                    // Update world material's texture (primary sequence)
                    this.setMaterialDiffuse(anim.material, anim.textures[frameIndex]);
                }
            }

            // Update brush model cloned materials (alternate or primary cycling)
            if (anim.altTextures) {
                const materialArrayIndex = this.materialIndexMap.get(anim.index);
                for (const [, animInfos] of this.brushModelAnimations) {
                    for (const info of animInfos) {
                        if (info.materialArrayIndex !== materialArrayIndex) continue;

                        if (info.showingAlt) {
                            // Cycle through alternate sequence
                            const altFrameIndex = info.altTextures.length > 1
                                ? Math.floor(this.time * 5) % info.altTextures.length
                                : 0;
                            this.setMaterialDiffuse(info.clonedMaterial, info.altTextures[altFrameIndex]);
                        } else if (anim.textures.length > 1) {
                            // Cycle through primary sequence (keep in sync with world)
                            const frameIndex = Math.floor(this.time * 5) % anim.textures.length;
                            this.setMaterialDiffuse(info.clonedMaterial, anim.textures[frameIndex]);
                        }
                    }
                }
            }
        }
    }

    /**
     * Update dynamic lights on all BSP materials
     * Called by Renderer.updateDynamicLights each frame
     * @param {Array} dlights - Array of dynamic light objects
     */
    updateDynamicLights(dlights) {
        // Update all shader materials with dynamic lights
        for (const material of this.materials) {
            if (material && material.isShaderMaterial && material.uniforms.dlightPositions) {
                updateDynamicLights(material, dlights);
            }
        }
    }

    /**
     * Set texture filtering mode for all loaded textures
     * @param {boolean} smooth - true for linear filtering, false for nearest (pixelated)
     */
    setTextureFiltering(smooth) {
        const filter = smooth ? THREE.LinearFilter : THREE.NearestFilter;

        // Update all world textures
        for (const texture of this.textures.values()) {
            texture.magFilter = filter;
            texture.minFilter = filter;
            texture.needsUpdate = true;
        }
    }

    /**
     * Build the texture sequence for an animated texture
     * Quake has two sequences per animated texture:
     * - Primary: +0name, +1name, +2name... (time-based animation)
     * - Alternate: +aname, +bname, +cname... (used when entity frame == 1)
     * R_TextureAnimation() in gl_rsurf.c selects between them based on currententity->frame
     */
    buildAnimatedTextureSequence(anim) {
        const primarySequence = [];
        const altSequence = [];

        // Collect primary sequence (0-9)
        for (let i = 0; i <= 9; i++) {
            const frameName = `+${i}${anim.sequenceName}`;
            const frameTexIndex = this.findTextureByName(frameName);
            if (frameTexIndex !== -1 && this.textures.has(frameTexIndex)) {
                primarySequence.push(this.textures.get(frameTexIndex));
            }
        }

        // Collect alternate sequence (a-j)
        const altChars = 'abcdefghij';
        for (let i = 0; i < altChars.length; i++) {
            const frameName = `+${altChars[i]}${anim.sequenceName}`;
            const frameTexIndex = this.findTextureByName(frameName);
            if (frameTexIndex !== -1 && this.textures.has(frameTexIndex)) {
                altSequence.push(this.textures.get(frameTexIndex));
            }
        }

        // Use primary sequence for time-based animation
        if (primarySequence.length > 1) {
            anim.textures = primarySequence;
        }

        // Store alternate sequence for entity-frame-based switching
        anim.altTextures = altSequence.length > 0 ? altSequence : null;
    }

    /**
     * Find texture index by name
     */
    findTextureByName(name) {
        const lowerName = name.toLowerCase();
        for (let i = 0; i < this.bsp.textures.length; i++) {
            const tex = this.bsp.textures[i];
            if (tex && tex.name.toLowerCase() === lowerName) {
                return i;
            }
        }
        return -1;
    }

    /**
     * Find animated materials used by a brush model's faces
     * Returns array of {materialArrayIndex, material, primaryTextures[], altTextures[]}
     */
    findAnimatedMaterialsForModel(model) {
        const result = [];
        const seen = new Set();

        for (let i = 0; i < model.numFaces; i++) {
            const faceIndex = model.firstFace + i;
            const face = this.bsp.faces[faceIndex];
            const texinfo = this.bsp.texinfo[face.texinfoNum];
            const textureIndex = texinfo.textureIndex;

            if (seen.has(textureIndex)) continue;
            seen.add(textureIndex);

            // Check if this texture is in the animated materials list
            const anim = this.animatedMaterials.find(a => a.index === textureIndex);
            if (!anim) continue;

            // Ensure sequences are built
            if (anim.textures.length === 1 && anim.sequenceName) {
                this.buildAnimatedTextureSequence(anim);
            }

            // Only include if there's an alternate sequence
            if (!anim.altTextures || anim.altTextures.length === 0) continue;

            const materialArrayIndex = this.materialIndexMap.get(textureIndex);
            result.push({
                materialArrayIndex,
                material: this.materials[materialArrayIndex],
                primaryTextures: anim.textures,
                altTextures: anim.altTextures
            });
        }

        return result;
    }

    /**
     * Set brush model frame (switches between primary and alternate texture sequences)
     * Original Quake: R_TextureAnimation checks currententity->frame
     * frame 0 = primary sequence (+0, +1, +2...), frame 1 = alternate sequence (+a, +b, +c...)
     * @param {THREE.Mesh} mesh - The brush model mesh
     * @param {number} frame - 0 for primary, 1 for alternate
     */
    setBrushModelFrame(mesh, frame) {
        const modelIndex = mesh.userData.brushModelIndex;
        if (modelIndex === undefined) return;

        const animInfos = this.brushModelAnimations.get(modelIndex);
        if (!animInfos) return;

        for (const info of animInfos) {
            info.showingAlt = (frame === 1 && info.altTextures.length > 0);

            const textures = info.showingAlt ? info.altTextures : info.primaryTextures;

            // Set first frame of the selected sequence immediately;
            // time-based cycling within the sequence is handled by update()
            this.setMaterialDiffuse(info.clonedMaterial, textures[0]);
        }
    }

    /**
     * Set the diffuse texture on a material, handling both ShaderMaterial (uniforms)
     * and standard materials (.map)
     */
    setMaterialDiffuse(material, texture) {
        if (!texture) return;

        if (material.isShaderMaterial && material.uniforms && material.uniforms.diffuseMap) {
            if (material.uniforms.diffuseMap.value !== texture) {
                material.uniforms.diffuseMap.value = texture;
            }
        } else if (material.map !== texture) {
            material.map = texture;
            material.needsUpdate = true;
        }
    }

    // Get leaf containing a point (for PVS culling)
    getLeafForPoint(point) {
        let nodeIndex = 0;

        while (nodeIndex >= 0) {
            const node = this.bsp.nodes[nodeIndex];
            const plane = this.bsp.planes[node.planeNum];

            const dist = point.x * plane.normal.x +
                         point.y * plane.normal.y +
                         point.z * plane.normal.z -
                         plane.dist;

            if (dist >= 0) {
                nodeIndex = node.children[0];
            } else {
                nodeIndex = node.children[1];
            }
        }

        // Convert to leaf index (negative node index)
        return -(nodeIndex + 1);
    }

    // Check if a leaf is visible from another leaf
    isLeafVisible(fromLeaf, toLeaf) {
        if (!this.bsp.visibility) return true;

        const leaf = this.bsp.leafs[fromLeaf];
        if (leaf.visOffset < 0) return true;

        // Decompress PVS for this leaf
        const pvs = this.decompressPVS(leaf.visOffset);
        return pvs[toLeaf >> 3] & (1 << (toLeaf & 7));
    }

    decompressPVS(offset) {
        const numLeafs = this.bsp.leafs.length;
        const pvs = new Uint8Array(Math.ceil(numLeafs / 8));
        let outIndex = 0;
        let inIndex = offset;

        while (outIndex < pvs.length) {
            const byte = this.bsp.visibility[inIndex++];

            if (byte) {
                pvs[outIndex++] = byte;
            } else {
                // Run of zeros
                const count = this.bsp.visibility[inIndex++];
                for (let i = 0; i < count && outIndex < pvs.length; i++) {
                    pvs[outIndex++] = 0;
                }
            }
        }

        return pvs;
    }

    /**
     * Sample light level at a point (R_LightPoint from original Quake r_light.c)
     * Returns a light intensity from 0.0 to 1.0
     *
     * Original Quake traces downward and samples the lightmap on the floor below.
     * This simplified version uses the leaf's ambient light level.
     *
     * @param {Object} point - Position {x, y, z}
     * @returns {number} Light intensity (0.0 to 1.0)
     */
    lightPoint(point) {
        if (!this.bsp.lighting || !this.bsp.faces) {
            return 1.0; // Full brightness if no lightmap data
        }

        // Find the leaf containing this point
        const leafIndex = this.getLeafForPoint(point);
        if (leafIndex < 0 || leafIndex >= this.bsp.leafs.length) {
            return 0.5; // Default ambient
        }

        const leaf = this.bsp.leafs[leafIndex];

        // Sample light by checking faces in the leaf's marksurfaces
        // Trace downward to find the floor surface
        let bestLight = 0.2; // Minimum ambient (r_ambient in Quake)

        // Check nearby faces for light levels
        if (leaf.firstMarkSurface >= 0 && leaf.numMarkSurfaces > 0) {
            for (let i = 0; i < leaf.numMarkSurfaces; i++) {
                const markIndex = leaf.firstMarkSurface + i;
                if (markIndex >= this.bsp.marksurfaces.length) continue;

                const faceIndex = this.bsp.marksurfaces[markIndex];
                if (faceIndex >= this.bsp.faces.length) continue;

                const face = this.bsp.faces[faceIndex];

                // Skip faces with no lightmap
                if (face.lightmapOffset < 0 || face.styles[0] === 255) continue;

                // Check if this is a floor-like surface (normal pointing up)
                const plane = this.bsp.planes[face.planeId];
                let normalZ = plane.normal.z;
                if (face.side) normalZ = -normalZ;

                // Only sample from horizontal-ish surfaces (floors)
                if (normalZ < 0.5) continue;

                // Sample average light from this face's lightmap
                const lightInfo = this.bsp.getFaceLightmapSize(faceIndex);
                const lightSize = lightInfo.width * lightInfo.height;

                if (lightSize > 0) {
                    let totalLight = 0;
                    for (let j = 0; j < lightSize; j++) {
                        const idx = face.lightmapOffset + j;
                        if (idx < this.bsp.lighting.length) {
                            totalLight += this.bsp.lighting[idx];
                        }
                    }
                    const avgLight = totalLight / lightSize / 255;
                    if (avgLight > bestLight) {
                        bestLight = avgLight;
                    }
                }
            }
        }

        // Clamp to reasonable range
        return Math.min(1.0, Math.max(0.1, bestLight));
    }
}
