import { NotFoundException } from '@nestjs/common';
import { ExerciseLibraryService } from './exercise-library.service';

function build() {
  const prisma: any = {
    exerciseLibrary: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
  };
  return { service: new ExerciseLibraryService(prisma), prisma };
}

describe('ExerciseLibraryService', () => {
  it('findAll: lista do coach, ordenada por categoria e nome', async () => {
    const { service, prisma } = build();
    prisma.exerciseLibrary.findMany.mockResolvedValue([{ id: 'i1' }]);
    await expect(service.findAll('coach-1')).resolves.toEqual([{ id: 'i1' }]);
    expect(prisma.exerciseLibrary.findMany).toHaveBeenCalledWith({
      where: { coachId: 'coach-1' }, orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  });

  it('findOne: escopado por coachId (findFirst) — item de outro coach não é encontrado', async () => {
    const { service, prisma } = build();
    prisma.exerciseLibrary.findFirst.mockResolvedValue(null);
    await expect(service.findOne('item-1', 'coach-1')).rejects.toThrow(NotFoundException);
    expect(prisma.exerciseLibrary.findFirst).toHaveBeenCalledWith({ where: { id: 'item-1', coachId: 'coach-1' } });
  });

  it('findOne: encontrado devolve o item', async () => {
    const { service, prisma } = build();
    prisma.exerciseLibrary.findFirst.mockResolvedValue({ id: 'item-1' });
    await expect(service.findOne('item-1', 'coach-1')).resolves.toEqual({ id: 'item-1' });
  });

  it('create: grava com o coachId', async () => {
    const { service, prisma } = build();
    prisma.exerciseLibrary.create.mockResolvedValue({ id: 'item-1', name: 'Snatch' });
    await service.create('coach-1', { name: 'Snatch' } as never);
    expect(prisma.exerciseLibrary.create).toHaveBeenCalledWith({ data: { name: 'Snatch', coachId: 'coach-1' } });
  });

  it('update: checa dono (IDOR) antes de escrever; item de outro coach → 404 sem update', async () => {
    const { service, prisma } = build();
    prisma.exerciseLibrary.findFirst.mockResolvedValue(null);
    await expect(service.update('item-1', 'coach-1', { name: 'x' } as never)).rejects.toThrow(NotFoundException);
    expect(prisma.exerciseLibrary.update).not.toHaveBeenCalled();
  });

  it('update: dono atualiza', async () => {
    const { service, prisma } = build();
    prisma.exerciseLibrary.findFirst.mockResolvedValue({ id: 'item-1' });
    prisma.exerciseLibrary.update.mockResolvedValue({ id: 'item-1', name: 'novo' });
    await expect(service.update('item-1', 'coach-1', { name: 'novo' } as never)).resolves.toEqual({ id: 'item-1', name: 'novo' });
    expect(prisma.exerciseLibrary.update).toHaveBeenCalledWith({ where: { id: 'item-1' }, data: { name: 'novo' } });
  });

  it('remove: checa dono; item de outro coach → 404 sem apagar', async () => {
    const { service, prisma } = build();
    prisma.exerciseLibrary.findFirst.mockResolvedValue(null);
    await expect(service.remove('item-1', 'coach-1')).rejects.toThrow(NotFoundException);
    expect(prisma.exerciseLibrary.delete).not.toHaveBeenCalled();
  });

  it('remove: dono apaga', async () => {
    const { service, prisma } = build();
    prisma.exerciseLibrary.findFirst.mockResolvedValue({ id: 'item-1' });
    prisma.exerciseLibrary.delete.mockResolvedValue({ id: 'item-1' });
    await expect(service.remove('item-1', 'coach-1')).resolves.toEqual({ id: 'item-1' });
  });
});
