// Browser API shims for running Quake server code in Deno
// Stubs out browser-specific APIs that the server doesn't need
//
// When code does `import * as THREE from 'three'`, it gets all named exports
// So we need to export each class/constant directly

// Mock performance.now() - Deno has this but let's be safe
if (typeof performance === 'undefined') {
	globalThis.performance = {
		now: () => Date.now()
	};
}

// Texture stub - server doesn't render textures
export class DataTexture {
	constructor() {
		this.needsUpdate = false;
	}
	dispose() {}
}

// Constants that might be referenced
export const RGBAFormat = 1023;
export const LinearFilter = 1006;
export const NearestFilter = 1003;
export const LinearMipmapLinearFilter = 1008;
export const NearestMipmapLinearFilter = 1005;
export const RepeatWrapping = 1000;
export const SRGBColorSpace = 'srgb';
export const FrontSide = 0;
export const BackSide = 1;
export const DoubleSide = 2;

// Vector2 - used for renderer dimensions
export class Vector2 {
	constructor(x = 0, y = 0) {
		this.x = x;
		this.y = y;
	}
	set(x, y) {
		this.x = x;
		this.y = y;
		return this;
	}
	floor() {
		this.x = Math.floor(this.x);
		this.y = Math.floor(this.y);
		return this;
	}
}

// Vector3 - might be used for math
export class Vector3 {
	constructor(x = 0, y = 0, z = 0) {
		this.x = x;
		this.y = y;
		this.z = z;
	}
	set(x, y, z) {
		this.x = x;
		this.y = y;
		this.z = z;
		return this;
	}
	copy(v) {
		this.x = v.x;
		this.y = v.y;
		this.z = v.z;
		return this;
	}
	clone() {
		return new Vector3(this.x, this.y, this.z);
	}
	add(v) {
		this.x += v.x;
		this.y += v.y;
		this.z += v.z;
		return this;
	}
	sub(v) {
		this.x -= v.x;
		this.y -= v.y;
		this.z -= v.z;
		return this;
	}
	multiplyScalar(s) {
		this.x *= s;
		this.y *= s;
		this.z *= s;
		return this;
	}
	length() {
		return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
	}
	normalize() {
		const len = this.length();
		if (len > 0) {
			this.x /= len;
			this.y /= len;
			this.z /= len;
		}
		return this;
	}
}

// Matrix4 - used for transforms in gl_mesh.js
export class Matrix4 {
	constructor() {
		this.elements = new Float32Array([
			1, 0, 0, 0,
			0, 1, 0, 0,
			0, 0, 1, 0,
			0, 0, 0, 1
		]);
	}
	set(n11, n12, n13, n14, n21, n22, n23, n24, n31, n32, n33, n34, n41, n42, n43, n44) {
		const e = this.elements;
		e[0] = n11; e[4] = n12; e[8] = n13; e[12] = n14;
		e[1] = n21; e[5] = n22; e[9] = n23; e[13] = n24;
		e[2] = n31; e[6] = n32; e[10] = n33; e[14] = n34;
		e[3] = n41; e[7] = n42; e[11] = n43; e[15] = n44;
		return this;
	}
	identity() { return this; }
	makeRotationX() { return this; }
	makeRotationY() { return this; }
	makeRotationZ() { return this; }
	makeTranslation() { return this; }
	multiply() { return this; }
	premultiply() { return this; }
	copy() { return this; }
	compose() { return this; }
	decompose() { return this; }
	setPosition() { return this; }
}

// Euler - used for rotations
export class Euler {
	constructor(x = 0, y = 0, z = 0, order = 'XYZ') {
		this.x = x;
		this.y = y;
		this.z = z;
		this.order = order;
	}
	set(x, y, z, order) {
		this.x = x;
		this.y = y;
		this.z = z;
		if (order) this.order = order;
		return this;
	}
}

// Quaternion - used for rotations
export class Quaternion {
	constructor(x = 0, y = 0, z = 0, w = 1) {
		this.x = x;
		this.y = y;
		this.z = z;
		this.w = w;
	}
	set(x, y, z, w) {
		this.x = x;
		this.y = y;
		this.z = z;
		this.w = w;
		return this;
	}
	setFromEuler() { return this; }
	setFromRotationMatrix() { return this; }
}

// Geometry stubs - server doesn't render
export class BufferGeometry {
	constructor() {
		this.attributes = {};
		this.index = null;
		this.boundingBox = null;
		this.boundingSphere = null;
	}
	setAttribute(name, attr) {
		this.attributes[name] = attr;
		return this;
	}
	getAttribute(name) {
		return this.attributes[name];
	}
	setIndex(index) {
		this.index = index;
		return this;
	}
	computeBoundingBox() {}
	computeBoundingSphere() {}
	dispose() {}
}

export class BufferAttribute {
	constructor(array, itemSize) {
		this.array = array;
		this.itemSize = itemSize;
		this.needsUpdate = false;
	}
}

export class Float32BufferAttribute extends BufferAttribute {
	constructor(array, itemSize) {
		super(array instanceof Float32Array ? array : new Float32Array(array), itemSize);
	}
}

export class Uint16BufferAttribute extends BufferAttribute {
	constructor(array, itemSize) {
		super(array instanceof Uint16Array ? array : new Uint16Array(array), itemSize);
	}
}

export class Uint32BufferAttribute extends BufferAttribute {
	constructor(array, itemSize) {
		super(array instanceof Uint32Array ? array : new Uint32Array(array), itemSize);
	}
}

// Material stubs
export class Material {
	constructor() {
		this.side = FrontSide;
		this.transparent = false;
		this.opacity = 1;
		this.visible = true;
	}
	dispose() {}
}

export class MeshBasicMaterial extends Material {
	constructor(params = {}) {
		super();
		this.map = params.map || null;
		this.color = params.color || { r: 1, g: 1, b: 1 };
		this.vertexColors = params.vertexColors || false;
	}
}

export class MeshLambertMaterial extends Material {
	constructor(params = {}) {
		super();
		this.map = params.map || null;
	}
}

export class SpriteMaterial extends Material {
	constructor(params = {}) {
		super();
		this.map = params.map || null;
	}
}

// Object3D stubs
export class Object3D {
	constructor() {
		this.position = new Vector3();
		this.rotation = new Euler();
		this.quaternion = new Quaternion();
		this.scale = new Vector3(1, 1, 1);
		this.matrix = new Matrix4();
		this.matrixWorld = new Matrix4();
		this.visible = true;
		this.children = [];
		this.parent = null;
	}
	add(obj) {
		this.children.push(obj);
		obj.parent = this;
	}
	remove(obj) {
		const idx = this.children.indexOf(obj);
		if (idx >= 0) this.children.splice(idx, 1);
		obj.parent = null;
	}
	updateMatrix() {}
	updateMatrixWorld() {}
}

export class PointLight extends Object3D {
	constructor(color, intensity = 1, distance = 0, decay = 2) {
		super();
		this.color = color;
		this.intensity = intensity;
		this.distance = distance;
		this.decay = decay;
	}
}

export class Mesh extends Object3D {
	constructor(geometry, material) {
		super();
		this.geometry = geometry;
		this.material = material;
	}
}

export class Sprite extends Object3D {
	constructor(material) {
		super();
		this.material = material;
	}
}

export class Group extends Object3D {
	constructor() {
		super();
	}
}

export class Scene extends Object3D {
	constructor() {
		super();
	}
}

// Color
export class Color {
	constructor(r = 1, g = 1, b = 1) {
		this.r = r;
		this.g = g;
		this.b = b;
	}
	setRGB(r, g, b) {
		this.r = r;
		this.g = g;
		this.b = b;
		return this;
	}
}

// Texture
export class Texture {
	constructor() {
		this.needsUpdate = false;
	}
	dispose() {}
}

export class CanvasTexture extends Texture {
	constructor() {
		super();
	}
}
