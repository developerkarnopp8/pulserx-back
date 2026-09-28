import { HttpStatus, ParseFilePipeBuilder } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

/** Imagens de tela (banner, foto, capa de exercício) — 5MB é mais que suficiente. */
export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

/** Um arquivo, campo `file`, com teto de tamanho já no multer (antes de ler tudo em memória). */
export const imageUploadInterceptor = FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_SIZE_BYTES, files: 1 } });

/** Só JPEG/PNG/WebP, conferido pelos magic bytes (não só pelo mimetype declarado). */
export const imageValidationPipe = new ParseFilePipeBuilder()
  .addFileTypeValidator({ fileType: /^image\/(jpeg|png|webp)$/ })
  .addMaxSizeValidator({ maxSize: MAX_IMAGE_SIZE_BYTES })
  .build({ errorHttpStatusCode: HttpStatus.BAD_REQUEST });
