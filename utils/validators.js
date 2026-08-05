function validateMinecraftPng(buffer, isCape = false) {
  if (!buffer || buffer.length < 24) {
    return { valid: false, error: 'Файл поврежден или слишком мал' };
  }
  // Check PNG signature: 89 50 4E 47 0D 0A 1A 0A
  const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47 &&
                buffer[4] === 0x0D && buffer[5] === 0x0A && buffer[6] === 0x1A && buffer[7] === 0x0A;
  if (!isPng) {
    return { valid: false, error: 'Файл не является корректным PNG-изображением' };
  }
  // Check IHDR chunk type
  const chunkType = buffer.toString('ascii', 12, 16);
  if (chunkType !== 'IHDR') {
    return { valid: false, error: 'Неверный формат PNG (отсутствует IHDR)' };
  }
  const width = buffer.readInt32BE(16);
  const height = buffer.readInt32BE(20);

  if (width <= 0 || height <= 0) {
    return { valid: false, error: 'Некорректные размеры изображения' };
  }

  if (isCape) {
    // Cape dimensions validation (normally 64x32 or ratios of it like 2:1)
    if (width % 64 !== 0 || height % 32 !== 0 || (width / height !== 2)) {
      return { valid: false, error: `Неверные размеры плаща (${width}x${height}). Отношение сторон должно быть 2:1 (например, 64x32)` };
    }
  } else {
    // Skin dimensions validation
    // Standard skin is 64x64 (ratio 1:1) or 64x32 (ratio 2:1)
    const ratio = width / height;
    if (ratio !== 1 && ratio !== 2) {
      return { valid: false, error: `Неверные пропорции скина (${width}x${height}). Соотношение сторон должно быть 1:1 или 2:1 (например, 64x64 или 64x32)` };
    }
    if (width % 64 !== 0) {
      return { valid: false, error: `Некорректное разрешение скина (${width}x${height}). Разрешение должно быть кратно 64 (например, 64x64, 128x128 и т.д.)` };
    }
  }

  return { valid: true, width, height };
}

module.exports = {
  validateMinecraftPng
};
