import { GUARDS_METADATA } from '@nestjs/common/constants';
import { PdfImportController } from './pdf-import.controller';
import { PdfImportService } from './pdf-import.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';

describe('PdfImportController — guards e roles', () => {
  it('aplica JwtAuthGuard e RolesGuard no controller inteiro', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, PdfImportController);
    expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
  });

  it('importFromPdf() exige role coach', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, PdfImportController.prototype.importFromPdf);
    expect(roles).toEqual(['coach']);
  });
});

describe('PdfImportController — delegação', () => {
  it('importFromPdf repassa o id do coach do token + dto + buffer do arquivo', () => {
    const service = { importFromPdf: jest.fn().mockResolvedValue({ id: 'plan-1' }) };
    const controller = new PdfImportController(service as unknown as PdfImportService);
    const req = { user: { id: 'coach-1' } };
    const dto = { studentId: 'student-1' };
    const file = { buffer: Buffer.from('pdf-fake') } as Express.Multer.File;

    controller.importFromPdf(req, dto as never, file);

    expect(service.importFromPdf).toHaveBeenCalledWith('coach-1', dto, file.buffer);
  });
});
