/**
 * TouchControls - Mobile touch input for Quake
 *
 * Provides:
 * - Virtual joystick for movement (left side)
 * - Touch area for looking (right side)
 * - Buttons for jump, fire, weapon switching
 */
export class TouchControls {
    constructor(container) {
        this.container = container;
        this.enabled = false;

        // Touch state
        this.moveTouch = null;      // Touch ID for movement joystick
        this.lookTouch = null;      // Touch ID for look area
        this.joystickOrigin = { x: 0, y: 0 };
        this.joystickCurrent = { x: 0, y: 0 };

        // Input state (consumed by InputManager)
        this.moveInput = { forward: 0, right: 0 };
        this.lookDelta = { x: 0, y: 0 };
        this.jumpPressed = false;
        this.firePressed = false;
        this.weaponSelect = 0;

        // Last look position for delta calculation
        this.lastLookPos = { x: 0, y: 0 };

        // Look touch origin and distance (for tap-to-jump detection)
        this.lookTouchOrigin = { x: 0, y: 0 };
        this.lookTouchDist = 0;
        this.jumpImpulse = false;  // One-frame jump trigger from tap

        // Pause callback (set externally)
        this.onPause = null;

        // Create UI elements
        this.createUI();

        // Bind touch handlers
        this.onTouchStart = this.onTouchStart.bind(this);
        this.onTouchMove = this.onTouchMove.bind(this);
        this.onTouchEnd = this.onTouchEnd.bind(this);
    }

    createUI() {
        // Main container for touch controls
        this.overlay = document.createElement('div');
        this.overlay.id = 'touch-controls';
        this.overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 200;
            display: none;
            touch-action: none;
        `;

        // Left side - movement joystick area
        this.joystickArea = document.createElement('div');
        this.joystickArea.style.cssText = `
            position: absolute;
            left: 0;
            top: 0;
            width: 40%;
            height: 100%;
            pointer-events: auto;
            touch-action: none;
        `;

        // Joystick base (appears when touching)
        this.joystickBase = document.createElement('div');
        this.joystickBase.style.cssText = `
            position: fixed;
            width: 120px;
            height: 120px;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.15);
            border: 2px solid rgba(255, 255, 255, 0.3);
            display: none;
            transform: translate(-50%, -50%);
            pointer-events: none;
        `;

        // Joystick knob
        this.joystickKnob = document.createElement('div');
        this.joystickKnob.style.cssText = `
            position: absolute;
            width: 50px;
            height: 50px;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.4);
            border: 2px solid rgba(255, 255, 255, 0.6);
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);
        `;
        this.joystickBase.appendChild(this.joystickKnob);
        this.joystickArea.appendChild(this.joystickBase);

        // Right side - look area (tap to jump, drag to look)
        this.lookArea = document.createElement('div');
        this.lookArea.style.cssText = `
            position: absolute;
            right: 0;
            top: 0;
            width: 60%;
            height: 100%;
            pointer-events: auto;
            touch-action: none;
        `;

        // Fire button (bottom right)
        this.fireButton = document.createElement('div');
        this.fireButton.style.cssText = `
            position: absolute;
            right: 20px;
            bottom: 20px;
            width: 70px;
            height: 70px;
            border-radius: 50%;
            background: rgba(255, 100, 100, 0.3);
            border: 2px solid rgba(255, 100, 100, 0.5);
            pointer-events: auto;
            touch-action: none;
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: sans-serif;
            font-size: 12px;
            color: rgba(255, 255, 255, 0.7);
        `;
        this.fireButton.textContent = 'FIRE';

        // Weapon switch buttons (compact row above action buttons)
        this.weaponBar = document.createElement('div');
        this.weaponBar.style.cssText = `
            position: absolute;
            right: 20px;
            bottom: 100px;
            display: flex;
            gap: 5px;
            pointer-events: auto;
            touch-action: none;
        `;

        this.weaponButtons = [];
        for (let i = 1; i <= 4; i++) {
            const btn = document.createElement('div');
            btn.style.cssText = `
                width: 35px;
                height: 35px;
                border-radius: 5px;
                background: rgba(255, 200, 100, 0.2);
                border: 1px solid rgba(255, 200, 100, 0.4);
                display: flex;
                align-items: center;
                justify-content: center;
                font-family: sans-serif;
                font-size: 14px;
                color: rgba(255, 255, 255, 0.7);
            `;
            btn.textContent = i.toString();
            btn.dataset.weapon = i;
            this.weaponButtons.push(btn);
            this.weaponBar.appendChild(btn);
        }

        // Pause button (top right corner)
        this.pauseButton = document.createElement('div');
        this.pauseButton.style.cssText = `
            position: absolute;
            right: 20px;
            top: 20px;
            width: 40px;
            height: 40px;
            border-radius: 5px;
            background: rgba(255, 255, 255, 0.15);
            border: 1px solid rgba(255, 255, 255, 0.3);
            pointer-events: auto;
            touch-action: none;
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: sans-serif;
            font-size: 16px;
            color: rgba(255, 255, 255, 0.7);
        `;
        this.pauseButton.textContent = '⏸';

        // Assemble UI
        this.overlay.appendChild(this.joystickArea);
        this.overlay.appendChild(this.lookArea);
        this.overlay.appendChild(this.fireButton);
        this.overlay.appendChild(this.weaponBar);
        this.overlay.appendChild(this.pauseButton);

        this.container.appendChild(this.overlay);
    }

    enable() {
        if (this.enabled) return;
        this.enabled = true;

        this.overlay.style.display = 'block';

        // Add touch listeners
        this.joystickArea.addEventListener('touchstart', this.onTouchStart, { passive: false });
        this.joystickArea.addEventListener('touchmove', this.onTouchMove, { passive: false });
        this.joystickArea.addEventListener('touchend', this.onTouchEnd, { passive: false });
        this.joystickArea.addEventListener('touchcancel', this.onTouchEnd, { passive: false });

        this.lookArea.addEventListener('touchstart', this.onTouchStart, { passive: false });
        this.lookArea.addEventListener('touchmove', this.onTouchMove, { passive: false });
        this.lookArea.addEventListener('touchend', this.onTouchEnd, { passive: false });
        this.lookArea.addEventListener('touchcancel', this.onTouchEnd, { passive: false });

        this.fireButton.addEventListener('touchstart', this.onTouchStart, { passive: false });
        this.fireButton.addEventListener('touchend', this.onTouchEnd, { passive: false });
        this.fireButton.addEventListener('touchcancel', this.onTouchEnd, { passive: false });

        for (const btn of this.weaponButtons) {
            btn.addEventListener('touchstart', this.onTouchStart, { passive: false });
            btn.addEventListener('touchend', this.onTouchEnd, { passive: false });
        }

        this.pauseButton.addEventListener('touchstart', this.onPausePress.bind(this), { passive: false });
    }

    onPausePress(e) {
        e.preventDefault();
        if (this.onPause) {
            this.onPause();
        }
    }

    disable() {
        if (!this.enabled) return;
        this.enabled = false;

        this.overlay.style.display = 'none';

        // Remove touch listeners
        this.joystickArea.removeEventListener('touchstart', this.onTouchStart);
        this.joystickArea.removeEventListener('touchmove', this.onTouchMove);
        this.joystickArea.removeEventListener('touchend', this.onTouchEnd);
        this.joystickArea.removeEventListener('touchcancel', this.onTouchEnd);

        this.lookArea.removeEventListener('touchstart', this.onTouchStart);
        this.lookArea.removeEventListener('touchmove', this.onTouchMove);
        this.lookArea.removeEventListener('touchend', this.onTouchEnd);
        this.lookArea.removeEventListener('touchcancel', this.onTouchEnd);

        this.fireButton.removeEventListener('touchstart', this.onTouchStart);
        this.fireButton.removeEventListener('touchend', this.onTouchEnd);
        this.fireButton.removeEventListener('touchcancel', this.onTouchEnd);

        for (const btn of this.weaponButtons) {
            btn.removeEventListener('touchstart', this.onTouchStart);
            btn.removeEventListener('touchend', this.onTouchEnd);
        }

        // Reset state
        this.moveTouch = null;
        this.lookTouch = null;
        this.moveInput = { forward: 0, right: 0 };
        this.lookDelta = { x: 0, y: 0 };
        this.jumpPressed = false;
        this.jumpImpulse = false;
        this.firePressed = false;
        this.weaponSelect = 0;
    }

    onTouchStart(e) {
        e.preventDefault();

        for (const touch of e.changedTouches) {
            const target = e.currentTarget;

            if (target === this.joystickArea && this.moveTouch === null) {
                // Start joystick
                this.moveTouch = touch.identifier;
                this.joystickOrigin.x = touch.clientX;
                this.joystickOrigin.y = touch.clientY;
                this.joystickCurrent.x = touch.clientX;
                this.joystickCurrent.y = touch.clientY;

                // Show joystick at touch position
                this.joystickBase.style.display = 'block';
                this.joystickBase.style.left = touch.clientX + 'px';
                this.joystickBase.style.top = touch.clientY + 'px';

            } else if (target === this.lookArea && this.lookTouch === null) {
                // Start look (also tracks tap for jump)
                this.lookTouch = touch.identifier;
                this.lastLookPos.x = touch.clientX;
                this.lastLookPos.y = touch.clientY;
                this.lookTouchOrigin.x = touch.clientX;
                this.lookTouchOrigin.y = touch.clientY;
                this.lookTouchDist = 0;

            } else if (target === this.fireButton) {
                this.firePressed = true;
                this.fireButton.style.background = 'rgba(255, 100, 100, 0.5)';

            } else if (target.dataset && target.dataset.weapon) {
                this.weaponSelect = parseInt(target.dataset.weapon);
                target.style.background = 'rgba(255, 200, 100, 0.5)';
            }
        }
    }

    onTouchMove(e) {
        e.preventDefault();

        for (const touch of e.changedTouches) {
            if (touch.identifier === this.moveTouch) {
                // Update joystick
                this.joystickCurrent.x = touch.clientX;
                this.joystickCurrent.y = touch.clientY;

                // Calculate offset from origin
                const dx = this.joystickCurrent.x - this.joystickOrigin.x;
                const dy = this.joystickCurrent.y - this.joystickOrigin.y;

                // Clamp to max radius
                const maxRadius = 50;
                const dist = Math.sqrt(dx * dx + dy * dy);
                let clampedX = dx;
                let clampedY = dy;

                if (dist > maxRadius) {
                    clampedX = (dx / dist) * maxRadius;
                    clampedY = (dy / dist) * maxRadius;
                }

                // Update knob position
                this.joystickKnob.style.left = `calc(50% + ${clampedX}px)`;
                this.joystickKnob.style.top = `calc(50% + ${clampedY}px)`;

                // Convert to normalized input (-1 to 1)
                // Note: Y is inverted (up = forward = positive)
                this.moveInput.right = clampedX / maxRadius;
                this.moveInput.forward = -clampedY / maxRadius;

            } else if (touch.identifier === this.lookTouch) {
                // Calculate look delta
                const dx = touch.clientX - this.lastLookPos.x;
                const dy = touch.clientY - this.lastLookPos.y;

                this.lookDelta.x += dx;
                this.lookDelta.y += dy;

                this.lastLookPos.x = touch.clientX;
                this.lastLookPos.y = touch.clientY;

                // Track total distance from origin (for tap detection)
                const totalDx = touch.clientX - this.lookTouchOrigin.x;
                const totalDy = touch.clientY - this.lookTouchOrigin.y;
                this.lookTouchDist = Math.sqrt(totalDx * totalDx + totalDy * totalDy);
            }
        }
    }

    onTouchEnd(e) {
        e.preventDefault();

        for (const touch of e.changedTouches) {
            const target = e.currentTarget;

            if (touch.identifier === this.moveTouch) {
                // Reset joystick
                this.moveTouch = null;
                this.moveInput.forward = 0;
                this.moveInput.right = 0;
                this.joystickBase.style.display = 'none';
                this.joystickKnob.style.left = '50%';
                this.joystickKnob.style.top = '50%';

            } else if (touch.identifier === this.lookTouch) {
                // End look - if barely moved, it was a tap = jump
                if (this.lookTouchDist < 10) {
                    this.jumpImpulse = true;
                }
                this.lookTouch = null;

            } else if (target === this.fireButton) {
                this.firePressed = false;
                this.fireButton.style.background = 'rgba(255, 100, 100, 0.3)';

            } else if (target.dataset && target.dataset.weapon) {
                target.style.background = 'rgba(255, 200, 100, 0.2)';
            }
        }
    }

    getMoveInput() {
        return {
            forward: this.moveInput.forward,
            right: this.moveInput.right
        };
    }

    getLookDelta() {
        const delta = {
            x: this.lookDelta.x,
            y: this.lookDelta.y
        };
        // Clear delta after reading
        this.lookDelta.x = 0;
        this.lookDelta.y = 0;
        return delta;
    }

    isJumpPressed() {
        if (this.jumpImpulse) {
            this.jumpImpulse = false;
            return true;
        }
        return this.jumpPressed;
    }

    isFirePressed() {
        return this.firePressed;
    }

    getWeaponSelect() {
        const weapon = this.weaponSelect;
        this.weaponSelect = 0;  // Clear after reading
        return weapon;
    }

    destroy() {
        this.disable();
        if (this.overlay && this.overlay.parentNode) {
            this.overlay.parentNode.removeChild(this.overlay);
        }
    }
}
