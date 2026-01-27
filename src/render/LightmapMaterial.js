import * as THREE from 'three';

/**
 * LightmapMaterial - Custom shader for Quake-style lightmapped surfaces
 *
 * Combines diffuse texture with lightmap using multiplication.
 * This matches original Quake: pre-baked lightmaps, no dynamic lights on world.
 *
 * Note on lightmap values:
 * GLQuake inverts lightmap values (255-t) and uses GL_ONE_MINUS_SRC_COLOR blending.
 * We use direct multiplication instead, which produces equivalent results:
 *   GLQuake: texture * (1 - (255-light)/255) = texture * light/255
 *   JavaScript: texture * light/255
 * No inversion is needed because the blend modes differ.
 *
 * Dynamic Lighting:
 * Original Quake (R_AddDynamicLights in gl_rsurf.c) modifies lightmaps on CPU each frame.
 * We use a shader-based approach for better performance: dynamic lights are added in
 * the fragment shader based on world position.
 */

// Maximum number of dynamic lights (original Quake: MAX_DLIGHTS = 32)
const MAX_DLIGHTS = 8;

const vertexShader = `
attribute vec2 uv2;

varying vec2 vUv;
varying vec2 vLightmapUv;
varying vec3 vWorldPosition;

void main() {
    vUv = uv;
    vLightmapUv = uv2;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const fragmentShader = `
uniform sampler2D diffuseMap;
uniform sampler2D lightMap;
uniform float lightMapIntensity;

// Dynamic lights (position.xyz, radius in w)
uniform vec4 dlightPositions[${MAX_DLIGHTS}];
uniform vec3 dlightColors[${MAX_DLIGHTS}];
uniform int dlightCount;

varying vec2 vUv;
varying vec2 vLightmapUv;
varying vec3 vWorldPosition;

void main() {
    vec4 diffuse = texture2D(diffuseMap, vUv);
    vec4 light = texture2D(lightMap, vLightmapUv);

    // Start with static lightmap
    vec3 totalLight = light.rgb * lightMapIntensity;

    // Add dynamic lights (similar to R_AddDynamicLights in gl_rsurf.c)
    for (int i = 0; i < ${MAX_DLIGHTS}; i++) {
        if (i >= dlightCount) break;

        vec3 lightPos = dlightPositions[i].xyz;
        float radius = dlightPositions[i].w;

        // Calculate distance to light
        vec3 toLight = lightPos - vWorldPosition;
        float dist = length(toLight);

        // Quake-style attenuation: linear falloff from radius
        // Original: contribution = (radius - dist) if dist < radius
        if (dist < radius) {
            float attenuation = (radius - dist) / radius;
            totalLight += dlightColors[i] * attenuation;
        }
    }

    // Multiply diffuse by total lighting
    vec3 finalColor = diffuse.rgb * totalLight;

    gl_FragColor = vec4(finalColor, diffuse.a);

    #include <tonemapping_fragment>
}
`;

// Simpler version without lightmap for special surfaces
const fragmentShaderNoLightmap = `
uniform sampler2D diffuseMap;

varying vec2 vUv;

void main() {
    gl_FragColor = texture2D(diffuseMap, vUv);

    #include <tonemapping_fragment>
}
`;

// Create default arrays for dynamic light uniforms
function createDlightUniforms() {
    const positions = [];
    const colors = [];
    for (let i = 0; i < MAX_DLIGHTS; i++) {
        positions.push(new THREE.Vector4(0, 0, 0, 0));
        colors.push(new THREE.Vector3(0, 0, 0));
    }
    return {
        dlightPositions: { value: positions },
        dlightColors: { value: colors },
        dlightCount: { value: 0 }
    };
}

export function createLightmapMaterial(diffuseTexture, lightmapTexture, options = {}) {
    const {
        transparent = false,
        opacity = 1.0,
        side = THREE.FrontSide,
        lightMapIntensity = 2.0  // GLQuake uses overbright bits, 2.0 approximates this
    } = options;

    if (!lightmapTexture) {
        // No lightmap - use simple material
        return new THREE.ShaderMaterial({
            uniforms: {
                diffuseMap: { value: diffuseTexture }
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: fragmentShaderNoLightmap,
            transparent,
            opacity,
            side
        });
    }

    const dlightUniforms = createDlightUniforms();

    return new THREE.ShaderMaterial({
        uniforms: {
            diffuseMap: { value: diffuseTexture },
            lightMap: { value: lightmapTexture },
            lightMapIntensity: { value: lightMapIntensity },
            ...dlightUniforms
        },
        vertexShader,
        fragmentShader,
        transparent,
        side
    });
}

/**
 * Update dynamic light uniforms on a material
 * @param {THREE.ShaderMaterial} material - Material to update
 * @param {Array} dlights - Array of { position: {x,y,z}, radius: number, color: {r,g,b} }
 */
export function updateDynamicLights(material, dlights) {
    if (!material.uniforms.dlightPositions) return;

    const count = Math.min(dlights.length, MAX_DLIGHTS);
    material.uniforms.dlightCount.value = count;

    for (let i = 0; i < MAX_DLIGHTS; i++) {
        if (i < count) {
            const light = dlights[i];
            material.uniforms.dlightPositions.value[i].set(
                light.position.x,
                light.position.y,
                light.position.z,
                light.radius
            );
            // Color is normalized 0-1, original Quake uses intensity in radius
            material.uniforms.dlightColors.value[i].set(
                light.color?.r || 1,
                light.color?.g || 1,
                light.color?.b || 1
            );
        } else {
            // Clear unused lights
            material.uniforms.dlightPositions.value[i].set(0, 0, 0, 0);
            material.uniforms.dlightColors.value[i].set(0, 0, 0);
        }
    }
}

export { MAX_DLIGHTS };

// Create a material with vertex colors for fallback
export function createVertexColorMaterial(diffuseTexture, options = {}) {
    const {
        transparent = false,
        opacity = 1.0,
        side = THREE.FrontSide
    } = options;

    return new THREE.MeshBasicMaterial({
        map: diffuseTexture,
        vertexColors: true,
        transparent,
        opacity,
        side
    });
}
