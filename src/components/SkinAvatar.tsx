import React, { useEffect, useRef } from 'react';

interface SkinAvatarProps {
  skinUrl?: string | null;
  uuid?: string;
  username?: string;
  size?: number;
  className?: string;
}

export const SkinAvatar: React.FC<SkinAvatarProps> = ({
  skinUrl,
  uuid,
  username,
  size = 28,
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.imageSmoothingEnabled = false;

    // If local/uploaded skin (data URL or direct PNG): render head layer + hat/helm overlay directly
    if (skinUrl) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        ctx.clearRect(0, 0, 64, 64);

        // 1. Base Head Layer (x: 8, y: 8, w: 8, h: 8) -> scale to full 64x64
        ctx.drawImage(img, 8, 8, 8, 8, 0, 0, 64, 64);

        // 2. Hat / Helmet Overlay Layer (x: 40, y: 8, w: 8, h: 8) -> overlay on top
        ctx.drawImage(img, 40, 8, 8, 8, 0, 0, 64, 64);
      };
      img.src = skinUrl;
    } else {
      // For online skins without local texture: fetch official render with overlay included
      const identifier = uuid || username || 'steve';
      const remoteImg = new Image();
      remoteImg.crossOrigin = 'anonymous';
      remoteImg.onload = () => {
        ctx.clearRect(0, 0, 64, 64);
        ctx.drawImage(remoteImg, 0, 0, 64, 64);
      };
      // mc-heads.net /avatar with /overlay renders the hat/helmet layer included!
      remoteImg.src = `https://mc-heads.net/avatar/${identifier}/64`;
    }
  }, [skinUrl, uuid, username]);

  return (
    <canvas
      ref={canvasRef}
      width={64}
      height={64}
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`rounded-full bg-neutral-900 border border-white/10 shrink-0 ${className}`}
    />
  );
};
