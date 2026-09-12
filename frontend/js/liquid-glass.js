/**
 * VROOM Liquid Glass Engine
 * Apple Liquid Glass-inspired material layer for selective F1 engineering workstation surfaces.
 * 
 * Technical Reference: dashersw/liquid-glass-js
 * 
 * Key Principles:
 * - DOM remains 100% the source of truth (text, charts, buttons, layouts are untouched native DOM).
 * - WebGL operates strictly as an optical underlay layer (position: absolute, z-index: 0).
 * - Uses signed-distance field (rounded rectangle) with shape-aware normals, edge refraction,
 *   rim specular highlight, corner boost, and subtle ripple deflection from liquid-glass-js.
 * - Controlled background texture (VROOM 32px technical dot grid and atmospheric canvas),
 *   eliminating heavy full-page DOM rasterization and preventing coordinate distortions.
 * - Header and secondary controls use lightweight hardware-accelerated CSS glass.
 * - Viewport culling (IntersectionObserver) ensures offscreen elements consume 0 GPU cycles.
 * - Graceful fallback to CSS backdrop-filter if WebGL is unavailable.
 */

(function () {
  'use strict';

  // --- GLSL Vertex Shader ---
  const VS_SOURCE = `
    attribute vec2 a_position;
    attribute vec2 a_texcoord;
    varying vec2 v_texcoord;

    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
      v_texcoord = a_texcoord;
    }
  `;

  // --- GLSL Fragment Shader (Adapted from liquid-glass-js) ---
  const FS_SOURCE = `
    precision mediump float;

    uniform sampler2D u_image;
    uniform vec2 u_resolution;
    uniform vec2 u_textureSize;
    uniform float u_scrollY;
    uniform float u_blurRadius;
    uniform float u_borderRadius;
    uniform vec2 u_containerPosition;
    uniform float u_edgeIntensity;
    uniform float u_rimIntensity;
    uniform float u_baseIntensity;
    uniform float u_edgeDistance;
    uniform float u_rimDistance;
    uniform float u_baseDistance;
    uniform float u_cornerBoost;
    uniform float u_rippleEffect;
    uniform float u_tintOpacity;
    uniform vec3 u_topTint;
    uniform vec3 u_bottomTint;

    varying vec2 v_texcoord;

    // Signed distance to rounded rectangle edge
    float roundedRectDistance(vec2 coord, vec2 size, float radius) {
      vec2 center = size * 0.5;
      vec2 pixelCoord = coord * size;
      vec2 toCorner = abs(pixelCoord - center) - (center - radius);
      float outsideCorner = length(max(toCorner, 0.0));
      float insideCorner = min(max(toCorner.x, toCorner.y), 0.0);
      return outsideCorner + insideCorner - radius;
    }

    void main() {
      vec2 coord = v_texcoord;

      // Coordinate mapping from screen viewport to background texture coordinates
      vec2 containerCenter = u_containerPosition + vec2(0.0, u_scrollY);
      vec2 containerOffset = (coord - 0.5) * u_resolution;
      vec2 pagePixel = containerCenter + containerOffset;
      vec2 textureCoord = pagePixel / max(u_textureSize, vec2(1.0, 1.0));

      // Calculate distance from edge and shape normal
      float distFromEdgeShape = max(-roundedRectDistance(coord, u_resolution, u_borderRadius), 0.0);
      vec2 shapeNormal = normalize(coord - 0.5);

      float minDim = max(min(u_resolution.x, u_resolution.y), 1.0);
      float distFromEdge = distFromEdgeShape / minDim;

      // Refraction curves (exponential attenuation from liquid-glass-js)
      float normDist = distFromEdge * minDim;
      float baseIntensity = (1.0 - exp(-normDist * u_baseDistance)) * u_baseIntensity;
      float edgeIntensity = exp(-normDist * u_edgeDistance) * u_edgeIntensity;
      float rimIntensity = exp(-normDist * u_rimDistance) * u_rimIntensity;
      float totalIntensity = baseIntensity + edgeIntensity + rimIntensity;

      // Corner boost for rounded corners
      float cornerX = min(coord.x, 1.0 - coord.x);
      float cornerY = min(coord.y, 1.0 - coord.y);
      float cornerDist = max(cornerX, cornerY) * minDim;
      float cornerBoost = exp(-cornerDist * 0.3) * u_cornerBoost;

      // Perpendicular micro-deflection for subtle liquid ripple
      vec2 perp = vec2(-shapeNormal.y, shapeNormal.x);
      float ripple = sin(distFromEdge * 25.0) * u_rippleEffect * rimIntensity;

      vec2 totalRefraction = shapeNormal * (totalIntensity + cornerBoost) + perp * ripple;
      vec2 refractedCoord = textureCoord + totalRefraction;

      // Multi-sample Gaussian blur around refracted coordinates
      vec4 blurredColor = vec4(0.0);
      vec2 texelSize = 1.0 / max(u_textureSize, vec2(1.0, 1.0));
      float sigma = max(u_blurRadius * 0.5, 0.1);
      vec2 blurStep = texelSize * sigma;
      float totalWeight = 0.0;

      for (float i = -3.0; i <= 3.0; i += 1.0) {
        for (float j = -3.0; j <= 3.0; j += 1.0) {
          float d = length(vec2(i, j));
          if (d > 3.0) continue;
          float w = exp(-(d * d) / (2.0 * sigma * sigma));
          vec2 offset = vec2(i, j) * blurStep;
          blurredColor += texture2D(u_image, refractedCoord + offset) * w;
          totalWeight += w;
        }
      }
      blurredColor /= max(totalWeight, 0.0001);

      // Subtle vertical gradient tinting (calibrated per window type)
      vec3 gradientTint = mix(u_topTint, u_bottomTint, coord.y);
      vec3 tinted = mix(blurredColor.rgb, gradientTint, u_tintOpacity);

      // Directional specular rim highlight simulating physical top-left lighting
      float specularHighlight = rimIntensity * max(0.0, -shapeNormal.y * 0.70 - shapeNormal.x * 0.30) * 0.25;
      tinted += vec3(specularHighlight);

      // Smoothstep anti-aliased shape alpha mask
      float maskDist = roundedRectDistance(coord, u_resolution, u_borderRadius);
      float mask = 1.0 - smoothstep(-1.0, 1.0, maskDist);

      gl_FragColor = vec4(tinted, mask);
    }
  `;

  class VroomGlassWindowMaterial {
    constructor(element) {
      this.element = element;
      this.isDark = element.classList.contains('vroom-glass-window-dark');

      // Calibrated parameters: low tint opacity so canvas & content remain visible
      if (this.isDark) {
        this.tintOpacity = 0.28; // 0.20 - 0.35
        this.blurRadius = 4.0;
        this.edgeIntensity = 0.012;
        this.rimIntensity = 0.034;
        this.baseIntensity = 0.006;
        this.topTint = [0.07, 0.10, 0.16];
        this.bottomTint = [0.04, 0.06, 0.10];
      } else {
        this.tintOpacity = 0.22; // 0.15 - 0.30
        this.blurRadius = 4.0;
        this.edgeIntensity = 0.011;
        this.rimIntensity = 0.030;
        this.baseIntensity = 0.005;
        this.topTint = [1.0, 1.0, 1.0];
        this.bottomTint = [0.94, 0.96, 0.98];
      }

      this.edgeDistance = 0.12;
      this.rimDistance = 0.75;
      this.baseDistance = 0.08;
      this.cornerBoost = 0.014;
      this.rippleEffect = 0.03;
      this.borderRadius = 8.0;

      this.canvas = null;
      this.gl = null;
      this.program = null;
      this.glRefs = {};
      this.isVisible = true;
      this.needsRedraw = true;

      this.createCanvas();
    }

    createCanvas() {
      // Remove any existing canvas before creating
      const existing = this.element.querySelector('.vroom-glass-canvas');
      if (existing) existing.remove();

      this.canvas = document.createElement('canvas');
      this.canvas.className = 'vroom-glass-canvas';
      this.element.insertBefore(this.canvas, this.element.firstChild);

      const glOpts = { alpha: true, depth: false, antialias: false, preserveDrawingBuffer: false };
      this.gl = this.canvas.getContext('webgl', glOpts) || this.canvas.getContext('experimental-webgl', glOpts);

      if (!this.gl) {
        this.element.classList.add('vroom-glass-fallback');
        if (this.canvas) this.canvas.style.display = 'none';
        return;
      }

      this.initShaders();
    }

    initShaders() {
      const gl = this.gl;
      const vs = this.compileShader(gl.VERTEX_SHADER, VS_SOURCE);
      const fs = this.compileShader(gl.FRAGMENT_SHADER, FS_SOURCE);
      if (!vs || !fs) return;

      const prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);

      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.error('[VROOM LiquidGlass] Program error:', gl.getProgramInfoLog(prog));
        return;
      }
      this.program = prog;

      // Full quad buffers
      const posBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1,  1, -1, -1,  1,
        -1,  1,  1, -1,  1,  1
      ]), gl.STATIC_DRAW);

      const texBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, texBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        0, 1,  1, 1,  0, 0,
        0, 0,  1, 1,  1, 0
      ]), gl.STATIC_DRAW);

      this.glRefs = {
        posLoc: gl.getAttribLocation(prog, 'a_position'),
        texLoc: gl.getAttribLocation(prog, 'a_texcoord'),
        resolutionLoc: gl.getUniformLocation(prog, 'u_resolution'),
        textureSizeLoc: gl.getUniformLocation(prog, 'u_textureSize'),
        scrollYLoc: gl.getUniformLocation(prog, 'u_scrollY'),
        blurRadiusLoc: gl.getUniformLocation(prog, 'u_blurRadius'),
        borderRadiusLoc: gl.getUniformLocation(prog, 'u_borderRadius'),
        containerPosLoc: gl.getUniformLocation(prog, 'u_containerPosition'),
        edgeIntensityLoc: gl.getUniformLocation(prog, 'u_edgeIntensity'),
        rimIntensityLoc: gl.getUniformLocation(prog, 'u_rimIntensity'),
        baseIntensityLoc: gl.getUniformLocation(prog, 'u_baseIntensity'),
        edgeDistanceLoc: gl.getUniformLocation(prog, 'u_edgeDistance'),
        rimDistanceLoc: gl.getUniformLocation(prog, 'u_rimDistance'),
        baseDistanceLoc: gl.getUniformLocation(prog, 'u_baseDistance'),
        cornerBoostLoc: gl.getUniformLocation(prog, 'u_cornerBoost'),
        rippleEffectLoc: gl.getUniformLocation(prog, 'u_rippleEffect'),
        tintOpacityLoc: gl.getUniformLocation(prog, 'u_tintOpacity'),
        topTintLoc: gl.getUniformLocation(prog, 'u_topTint'),
        bottomTintLoc: gl.getUniformLocation(prog, 'u_bottomTint'),
        imageLoc: gl.getUniformLocation(prog, 'u_image'),
        posBuf,
        texBuf,
        texture: gl.createTexture()
      };

      this.updateDimensions();
    }

    compileShader(type, src) {
      const gl = this.gl;
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error('[VROOM LiquidGlass] Shader compile error:', gl.getShaderInfoLog(s));
        return null;
      }
      return s;
    }

    updateDimensions() {
      if (!this.canvas || !this.element) return;
      const rect = this.element.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(Math.round(rect.width), 1);
      const h = Math.max(Math.round(rect.height), 1);

      if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
        this.canvas.width = Math.round(w * dpr);
        this.canvas.height = Math.round(h * dpr);
        this.width = w;
        this.height = h;

        if (this.gl && this.glRefs.resolutionLoc) {
          this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        }
      }
      this.needsRedraw = true;
    }

    uploadTexture(imageSource) {
      if (!this.gl || !this.glRefs.texture || !imageSource) return;
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.glRefs.texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imageSource);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      this.textureWidth = imageSource.width || window.innerWidth;
      this.textureHeight = imageSource.height || window.innerHeight;
      this.needsRedraw = true;
    }

    render(scrollY, force = false) {
      if (!this.gl || !this.program || (!this.isVisible && !force)) return;
      if (!this.needsRedraw && !force) return;

      const gl = this.gl;
      const refs = this.glRefs;

      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clearColor(0.0, 0.0, 0.0, 0.0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.useProgram(this.program);

      // Attributes
      gl.bindBuffer(gl.ARRAY_BUFFER, refs.posBuf);
      gl.enableVertexAttribArray(refs.posLoc);
      gl.vertexAttribPointer(refs.posLoc, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, refs.texBuf);
      gl.enableVertexAttribArray(refs.texLoc);
      gl.vertexAttribPointer(refs.texLoc, 2, gl.FLOAT, false, 0, 0);

      // Uniforms
      gl.uniform2f(refs.resolutionLoc, this.width || 100, this.height || 100);
      gl.uniform2f(refs.textureSizeLoc, this.textureWidth || window.innerWidth, this.textureHeight || window.innerHeight);
      gl.uniform1f(refs.scrollYLoc, scrollY);
      gl.uniform1f(refs.blurRadiusLoc, this.blurRadius);
      gl.uniform1f(refs.borderRadiusLoc, this.borderRadius);

      // Center in page viewport coordinates
      const rect = this.element.getBoundingClientRect();
      const centerX = rect.left + rect.width * 0.5;
      const centerY = rect.top + rect.height * 0.5;
      gl.uniform2f(refs.containerPosLoc, centerX, centerY);

      gl.uniform1f(refs.edgeIntensityLoc, this.edgeIntensity);
      gl.uniform1f(refs.rimIntensityLoc, this.rimIntensity);
      gl.uniform1f(refs.baseIntensityLoc, this.baseIntensity);
      gl.uniform1f(refs.edgeDistanceLoc, this.edgeDistance);
      gl.uniform1f(refs.rimDistanceLoc, this.rimDistance);
      gl.uniform1f(refs.baseDistanceLoc, this.baseDistance);
      gl.uniform1f(refs.cornerBoostLoc, this.cornerBoost);
      gl.uniform1f(refs.rippleEffectLoc, this.rippleEffect);
      gl.uniform1f(refs.tintOpacityLoc, this.tintOpacity);
      gl.uniform3fv(refs.topTintLoc, this.topTint);
      gl.uniform3fv(refs.bottomTintLoc, this.bottomTint);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, refs.texture);
      gl.uniform1i(refs.imageLoc, 0);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
      this.needsRedraw = false;
    }
  }

  // --- Central Liquid Glass Controller ---
  class VroomLiquidGlassEngine {
    constructor() {
      this.instances = [];
      this.bgTextureCanvas = null;
      this.lastScrollY = -1;
      this.isTicking = false;
      this.observer = null;
    }

    init() {
      // Test WebGL capability
      const testCanvas = document.createElement('canvas');
      const testGl = testCanvas.getContext('webgl') || testCanvas.getContext('experimental-webgl');
      if (!testGl) {
        console.warn('[VROOM LiquidGlass] WebGL unavailable. Applying CSS fallback.');
        document.documentElement.classList.add('vroom-no-webgl');
        return;
      }

      this.initIntersectionObserver();
      this.createControlledBackdropTexture();
      this.setupInstances();
      this.attachEvents();
    }

    createControlledBackdropTexture() {
      // Generates a high-resolution representation of VROOM's signature 32px dot-grid canvas
      // This controlled backdrop ensures WebGL performs authentic optical refraction without
      // touching the DOM, avoiding layout collapse, coordinate mismatch, or recursive clones.
      const bgCanvas = document.createElement('canvas');
      bgCanvas.width = Math.min(window.innerWidth, 1920);
      bgCanvas.height = Math.max(document.body.scrollHeight || 3200, window.innerHeight * 2);
      const ctx = bgCanvas.getContext('2d');
      if (!ctx) return;

      // VROOM canvas base color
      ctx.fillStyle = '#fdfdfc';
      ctx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);

      // Subtle atmospheric aero sky gradient at top
      const skyGrad = ctx.createLinearGradient(0, 0, 0, 480);
      skyGrad.addColorStop(0, 'rgba(240, 246, 252, 0.45)');
      skyGrad.addColorStop(1, 'rgba(253, 253, 252, 0)');
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, bgCanvas.width, 480);

      // Precise dot-grid matching VROOM layout.css: radial-gradient(circle, rgba(15,23,42,0.11) 1.1px, transparent 1.1px); 32px 32px
      ctx.fillStyle = 'rgba(15, 23, 42, 0.11)';
      const dotRadius = 1.1;
      const step = 32;
      for (let x = 16; x < bgCanvas.width; x += step) {
        for (let y = 16; y < bgCanvas.height; y += step) {
          ctx.beginPath();
          ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Atmospheric Frutiger Aero sky section gradient at its exact page position
      const skySec = document.querySelector('.sky-atmospheric-section');
      if (skySec) {
        const skyRect = skySec.getBoundingClientRect();
        const curScrollY = window.pageYOffset || document.documentElement.scrollTop;
        const skyTop = skyRect.top + curScrollY;
        const skySectionGrad = ctx.createLinearGradient(0, skyTop, 0, skyTop + skyRect.height);
        skySectionGrad.addColorStop(0, '#0284c7');
        skySectionGrad.addColorStop(0.52, '#38bdf8');
        skySectionGrad.addColorStop(1, '#bae6fd');
        ctx.fillStyle = skySectionGrad;
        ctx.fillRect(skyRect.left, skyTop, skyRect.width, skyRect.height);
      }

      this.bgTextureCanvas = bgCanvas;
      this.instances.forEach(inst => inst.uploadTexture(bgCanvas));
    }

    initIntersectionObserver() {
      if ('IntersectionObserver' in window) {
        this.observer = new IntersectionObserver((entries) => {
          entries.forEach(entry => {
            const instance = this.instances.find(inst => inst.element === entry.target);
            if (instance) {
              instance.isVisible = entry.isIntersecting;
              if (instance.isVisible) {
                instance.needsRedraw = true;
                this.requestRender();
              }
            }
          });
        }, { rootMargin: '100px 0px 100px 0px' });
      }
    }

    setupInstances() {
      // Primary macOS floating windows & sky benchmark glass windows receive WebGL underlay
      // Note: Header and secondary controls use CSS glass, guaranteeing 100% DOM stability
      const targets = document.querySelectorAll('.mac-window.vroom-glass, .sky-glass-window.vroom-glass');
      targets.forEach(el => {
        if (this.instances.some(i => i.element === el)) return;

        const inst = new VroomGlassWindowMaterial(el);
        this.instances.push(inst);

        if (this.bgTextureCanvas) {
          inst.uploadTexture(this.bgTextureCanvas);
        }

        if (this.observer) {
          this.observer.observe(el);
        }
      });

      this.requestRender(true);
    }

    attachEvents() {
      // Passive, throttled requestAnimationFrame scroll updates
      window.addEventListener('scroll', () => {
        const curY = window.pageYOffset || document.documentElement.scrollTop;
        if (Math.abs(curY - this.lastScrollY) > 0.5) {
          this.lastScrollY = curY;
          this.instances.forEach(i => { if (i.isVisible) i.needsRedraw = true; });
          this.requestRender();
        }
      }, { passive: true });

      // Debounced resize
      let resizeTimer = null;
      window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          this.createControlledBackdropTexture();
          this.instances.forEach(i => i.updateDimensions());
          this.requestRender(true);
        }, 150);
      }, { passive: true });

      // Update when view changes in router
      window.addEventListener('vroom:viewchange', () => {
        setTimeout(() => {
          this.instances.forEach(i => {
            i.updateDimensions();
            i.needsRedraw = true;
          });
          this.requestRender(true);
        }, 40);
      });
    }

    requestRender(force = false) {
      if (this.isTicking && !force) return;
      this.isTicking = true;
      requestAnimationFrame(() => {
        const scrollY = window.pageYOffset || document.documentElement.scrollTop;
        this.instances.forEach(i => i.render(scrollY, force));
        this.isTicking = false;
      });
    }
  }

  // Export singleton
  window.VroomLiquidGlass = VroomLiquidGlassEngine;
  window.vroomLiquidGlass = new VroomLiquidGlassEngine();

})();
