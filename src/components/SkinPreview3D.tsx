import React, { useEffect, useRef } from 'react';
import { SkinViewer, IdleAnimation } from 'skinview3d';

interface SkinPreview3DProps {
  skinUrl: string;
  model: 'classic' | 'slim';
  width?: number;
  height?: number;
}

export const SkinPreview3D: React.FC<SkinPreview3DProps> = ({
  skinUrl,
  model,
  width = 240,
  height = 260,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<SkinViewer | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    const viewer = new SkinViewer({
      canvas: canvasRef.current,
      width,
      height,
      skin: skinUrl || 'https://textures.minecraft.net/texture/31f45610ec3f317b960b73b98e1f5799793134fa969a572a5ea79c938f71295b',
      model: model === 'slim' ? 'slim' : 'default',
    });

    viewer.fov = 70;
    viewer.zoom = 0.9;
    viewer.autoRotate = false;
    viewer.playerObject.rotation.y = -0.4;
    viewer.animation = new IdleAnimation();

    // Mouse drag rotation
    let isDragging = false;
    let prevX = 0;
    let prevY = 0;

    const onMouseDown = (e: MouseEvent) => {
      isDragging = true;
      prevX = e.clientX;
      prevY = e.clientY;
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const deltaX = e.clientX - prevX;
      const deltaY = e.clientY - prevY;
      viewer.playerObject.rotation.y += deltaX * 0.015;
      viewer.playerObject.rotation.x += deltaY * 0.015;
      prevX = e.clientX;
      prevY = e.clientY;
    };

    const onMouseUp = () => {
      isDragging = false;
    };

    const canvas = canvasRef.current;
    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    viewerRef.current = viewer;

    return () => {
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      viewer.dispose();
      viewerRef.current = null;
    };
  }, [width, height]);

  useEffect(() => {
    if (viewerRef.current && skinUrl) {
      viewerRef.current.loadSkin(skinUrl, {
        model: model === 'slim' ? 'slim' : 'default',
      });
    }
  }, [skinUrl, model]);

  return (
    <div className="flex flex-col items-center justify-center relative select-none">
      <canvas
        ref={canvasRef}
        className="rounded-2xl border border-white/[0.08] bg-[#0A0A0A] shadow-inner cursor-grab active:cursor-grabbing outline-none"
      />
      <span className="text-[10px] text-white/30 mt-1.5 font-mono">Drag to rotate 3D model</span>
    </div>
  );
};
