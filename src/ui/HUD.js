import { WADLoader } from '../loaders/WADLoader.js';
import { indexedToRGBA, QUAKE_PALETTE } from '../loaders/Palette.js';

/**
 * HUD - Quake status bar (health, armor, ammo, face)
 *
 * Layout (320 pixels wide, centered):
 * - Armor icon + number (0-96)
 * - Face (112-136)
 * - Health number (136-208)
 * - Ammo icon + number (224-320)
 */

const SBAR_HEIGHT = 24;

export class HUD {
    constructor(container, pak) {
        this.pak = pak;
        this.container = container;

        // Create canvas overlay
        this.canvas = document.createElement('canvas');
        this.canvas.style.position = 'absolute';
        this.canvas.style.bottom = '0';
        this.canvas.style.left = '0';
        this.canvas.style.width = '100%';
        this.canvas.style.height = 'auto';
        this.canvas.style.imageRendering = 'pixelated';
        this.canvas.style.pointerEvents = 'none';
        container.appendChild(this.canvas);

        this.ctx = this.canvas.getContext('2d');

        // HUD graphics
        this.pics = new Map();
        this.loaded = false;

        // Scale factor
        this.scale = 2;

        this.loadGraphics();
    }

    async loadGraphics() {
        // Load gfx.wad
        const wadData = this.pak.get('gfx.wad');
        if (!wadData) {
            console.warn('gfx.wad not found');
            return;
        }

        const wad = new WADLoader();
        wad.load(wadData);

        // Load status bar backgrounds
        this.loadPic(wad, 'sbar');
        this.loadPic(wad, 'ibar');

        // Load numbers (yellow and red)
        for (let i = 0; i <= 9; i++) {
            this.loadPic(wad, `num_${i}`);
            this.loadPic(wad, `anum_${i}`);
        }
        this.loadPic(wad, 'num_minus');
        this.loadPic(wad, 'anum_minus');
        this.loadPic(wad, 'num_colon');
        this.loadPic(wad, 'num_slash');

        // Load faces (health-based)
        for (let i = 1; i <= 5; i++) {
            this.loadPic(wad, `face${i}`);
            this.loadPic(wad, `face_p${i}`);
        }
        this.loadPic(wad, 'face_invis');
        this.loadPic(wad, 'face_invul2');
        this.loadPic(wad, 'face_inv2');
        this.loadPic(wad, 'face_quad');

        // Load armor icons
        this.loadPic(wad, 'sb_armor1');
        this.loadPic(wad, 'sb_armor2');
        this.loadPic(wad, 'sb_armor3');

        // Load ammo icons
        this.loadPic(wad, 'sb_shells');
        this.loadPic(wad, 'sb_nails');
        this.loadPic(wad, 'sb_rocket');
        this.loadPic(wad, 'sb_cells');

        // Load weapon icons
        const weapons = ['shotgun', 'sshotgun', 'nailgun', 'snailgun', 'rlaunch', 'srlaunch', 'lightng'];
        for (const w of weapons) {
            this.loadPic(wad, `inv_${w}`);
            this.loadPic(wad, `inv2_${w}`);
        }

        // Load item icons
        this.loadPic(wad, 'sb_key1');
        this.loadPic(wad, 'sb_key2');
        this.loadPic(wad, 'sb_invis');
        this.loadPic(wad, 'sb_invuln');
        this.loadPic(wad, 'sb_suit');
        this.loadPic(wad, 'sb_quad');

        // Load sigils
        for (let i = 1; i <= 4; i++) {
            this.loadPic(wad, `sb_sigil${i}`);
        }

        this.loaded = true;
        console.log('HUD graphics loaded');
    }

    loadPic(wad, name) {
        const pic = wad.get(name);
        if (!pic || !pic.data) {
            return;
        }

        // Convert to RGBA with transparency (index 255 = transparent)
        const rgba = new Uint8Array(pic.width * pic.height * 4);
        for (let i = 0; i < pic.data.length; i++) {
            const palIdx = pic.data[i];
            const dstIdx = i * 4;

            if (palIdx === 255) {
                // Transparent
                rgba[dstIdx] = 0;
                rgba[dstIdx + 1] = 0;
                rgba[dstIdx + 2] = 0;
                rgba[dstIdx + 3] = 0;
            } else {
                rgba[dstIdx] = QUAKE_PALETTE[palIdx * 3];
                rgba[dstIdx + 1] = QUAKE_PALETTE[palIdx * 3 + 1];
                rgba[dstIdx + 2] = QUAKE_PALETTE[palIdx * 3 + 2];
                rgba[dstIdx + 3] = 255;
            }
        }

        // Create ImageData
        const imageData = new ImageData(
            new Uint8ClampedArray(rgba.buffer),
            pic.width,
            pic.height
        );

        // Create offscreen canvas for this pic
        const canvas = document.createElement('canvas');
        canvas.width = pic.width;
        canvas.height = pic.height;
        const ctx = canvas.getContext('2d');
        ctx.putImageData(imageData, 0, 0);

        this.pics.set(name, {
            canvas,
            width: pic.width,
            height: pic.height
        });
    }

    resize() {
        const containerWidth = this.container.clientWidth;
        const containerHeight = this.container.clientHeight;

        // Calculate scale to fit 320px wide status bar
        // Cap at 2x on desktop, ~1.3x on mobile (1.5x smaller)
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
                         (navigator.maxTouchPoints && navigator.maxTouchPoints > 2);
        const maxScale = isMobile ? 1.33 : 2;
        this.scale = Math.min(maxScale, Math.max(1, containerWidth / 320));

        // Set canvas size
        this.canvas.width = 320 * this.scale;
        this.canvas.height = 48 * this.scale; // sbar + ibar

        // Position at bottom center
        this.canvas.style.width = `${this.canvas.width}px`;
        this.canvas.style.height = `${this.canvas.height}px`;
        this.canvas.style.left = `${(containerWidth - this.canvas.width) / 2}px`;

        // Disable smoothing for pixel-perfect scaling
        this.ctx.imageSmoothingEnabled = false;
    }

    draw(player) {
        if (!this.loaded || !player) return;

        this.resize();

        const ctx = this.ctx;
        const s = this.scale;

        // Clear
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw inventory bar (above status bar)
        this.drawPic(0, 0, 'ibar');

        // Draw status bar background
        this.drawPic(0, 24, 'sbar');

        // Draw armor - armorType is 0.3 (green), 0.6 (yellow), 0.8 (red)
        const armorType = player.armorType || 0;
        if (armorType > 0 && player.armor > 0) {
            let armorIndex;
            if (armorType >= 0.8) armorIndex = 2;      // Red (sb_armor3)
            else if (armorType >= 0.6) armorIndex = 1; // Yellow (sb_armor2)
            else armorIndex = 0;                        // Green (sb_armor1)
            const armorPics = ['sb_armor1', 'sb_armor2', 'sb_armor3'];
            this.drawPic(0, 24, armorPics[armorIndex]);
        }
        this.drawNum(24, 24, player.armor || 0, 3, player.armor <= 25);

        // Draw face
        this.drawFace(112, 24, player);

        // Draw health
        this.drawNum(136, 24, player.health || 0, 3, player.health <= 25);

        // Draw ammo icon based on current weapon
        const ammoIcons = {
            shells: 'sb_shells',
            nails: 'sb_nails',
            rockets: 'sb_rocket',
            cells: 'sb_cells'
        };
        const currentAmmoType = this.getAmmoType(player.currentWeapon);
        if (currentAmmoType && ammoIcons[currentAmmoType]) {
            this.drawPic(224, 24, ammoIcons[currentAmmoType]);
        }

        // Draw ammo count
        const ammoCount = currentAmmoType ? (player.ammo[currentAmmoType] || 0) : 0;
        this.drawNum(248, 24, ammoCount, 3, ammoCount <= 10);

        // Draw weapons in inventory bar
        this.drawWeapons(player);

        // Draw ammo counts in inventory bar
        this.drawAmmoCounts(player);
    }

    drawPic(x, y, name) {
        const pic = this.pics.get(name);
        if (!pic) return;

        const s = this.scale;
        this.ctx.drawImage(pic.canvas, x * s, y * s, pic.width * s, pic.height * s);
    }

    drawNum(x, y, num, digits, red = false) {
        const prefix = red ? 'anum_' : 'num_';
        const str = Math.abs(num).toString();
        const isNegative = num < 0;

        let drawX = x;

        // Right-align
        const totalDigits = isNegative ? str.length + 1 : str.length;
        if (totalDigits < digits) {
            drawX += (digits - totalDigits) * 24;
        }

        // Draw minus sign if negative
        if (isNegative) {
            this.drawPic(drawX, y, prefix + 'minus');
            drawX += 24;
        }

        // Draw digits
        for (const char of str) {
            this.drawPic(drawX, y, prefix + char);
            drawX += 24;
        }
    }

    drawFace(x, y, player) {
        const health = player.health || 0;
        const items = player.items || 0;

        // Check for powerup faces (using correct IT_* flags from Player.js)
        const IT_INVISIBILITY = 524288;     // 0x80000
        const IT_INVULNERABILITY = 1048576; // 0x100000
        const IT_QUAD = 4194304;            // 0x400000

        if ((items & IT_INVISIBILITY) && (items & IT_INVULNERABILITY)) {
            this.drawPic(x, y, 'face_inv2');
            return;
        }
        if (items & IT_QUAD) {
            this.drawPic(x, y, 'face_quad');
            return;
        }
        if (items & IT_INVISIBILITY) {
            this.drawPic(x, y, 'face_invis');
            return;
        }
        if (items & IT_INVULNERABILITY) {
            this.drawPic(x, y, 'face_invul2');
            return;
        }

        // Health-based face (face1 = healthy, face5 = hurt)
        // Original: f = health / 20, then sb_faces[f] where [0]=face5, [4]=face1
        let faceNum;
        if (health >= 80) {
            faceNum = 1;  // Healthy
        } else if (health >= 60) {
            faceNum = 2;
        } else if (health >= 40) {
            faceNum = 3;
        } else if (health >= 20) {
            faceNum = 4;
        } else {
            faceNum = 5;  // Hurt
        }

        // TODO: Use pain face (face_p*) when recently damaged
        this.drawPic(x, y, `face${faceNum}`);
    }

    drawWeapons(player) {
        const weapons = player.weapons || 0;
        const currentWeapon = player.currentWeapon || 1;

        // Weapon bits: IT_SHOTGUN=1, IT_SUPER_SHOTGUN=2, etc.
        const weaponNames = ['shotgun', 'sshotgun', 'nailgun', 'snailgun', 'rlaunch', 'srlaunch', 'lightng'];
        const weaponBits = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40];
        const weaponNums = [2, 3, 4, 5, 6, 7, 8]; // Weapon slot numbers

        for (let i = 0; i < 7; i++) {
            if (weapons & weaponBits[i]) {
                // Use inv2_ (highlighted) if this is the current weapon
                const prefix = (currentWeapon === weaponNums[i]) ? 'inv2_' : 'inv_';
                this.drawPic(i * 24, 0, prefix + weaponNames[i]);
            }
        }
    }

    drawAmmoCounts(player) {
        const ammo = player.ammo || {};
        const ammoTypes = ['shells', 'nails', 'rockets', 'cells'];
        const s = this.scale;

        // Ammo counts are drawn at specific positions in the ibar
        // Using small font (8x8 characters)
        this.ctx.fillStyle = '#b5a27c'; // Quake brown/tan color
        this.ctx.font = `${8 * s}px monospace`;

        for (let i = 0; i < 4; i++) {
            const count = ammo[ammoTypes[i]] || 0;
            const str = count.toString().padStart(3, ' ');
            // Position: each ammo section is 48 pixels, numbers start at offset 8
            const x = (i * 48 + 8) * s;
            const y = 16 * s;
            this.ctx.fillText(str, x, y);
        }
    }

    getAmmoType(weapon) {
        // Map weapon number to ammo type
        const ammoMap = {
            1: null,      // Axe
            2: 'shells',  // Shotgun
            3: 'shells',  // Super Shotgun
            4: 'nails',   // Nailgun
            5: 'nails',   // Super Nailgun
            6: 'rockets', // Grenade Launcher
            7: 'rockets', // Rocket Launcher
            8: 'cells'    // Lightning Gun
        };
        return ammoMap[weapon] || null;
    }

    destroy() {
        if (this.canvas && this.canvas.parentNode) {
            this.canvas.parentNode.removeChild(this.canvas);
        }
    }
}
