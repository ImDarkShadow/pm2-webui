import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export interface QrCodeSvgProps {
  readonly value: string;
  readonly size?: number;
  readonly className?: string;
  readonly bgColor?: string;
  readonly fgColor?: string;
}

export const QrCodeSvg: React.FC<QrCodeSvgProps> = ({
  value,
  size = 200,
  className = '',
  bgColor = '#ffffff',
  fgColor = '#000000',
}) => {
  const [svgHtml, setSvgHtml] = useState<string>('');

  useEffect(() => {
    let isMounted = true;
    QRCode.toString(value, {
      type: 'svg',
      margin: 2,
      errorCorrectionLevel: 'M',
      color: {
        dark: fgColor,
        light: bgColor,
      },
      width: size,
    })
      .then((svg) => {
        if (isMounted) setSvgHtml(svg);
      })
      .catch((err) => {
        console.error('Failed to generate QR code SVG', err);
      });

    return () => {
      isMounted = false;
    };
  }, [value, size, bgColor, fgColor]);

  if (!svgHtml) {
    return (
      <div
        style={{ width: size, height: size }}
        className={`flex items-center justify-center bg-zinc-100 dark:bg-zinc-800 rounded-lg animate-pulse ${className}`}
      />
    );
  }

  return (
    <div
      className={`inline-block ${className}`}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: svgHtml }}
    />
  );
};
