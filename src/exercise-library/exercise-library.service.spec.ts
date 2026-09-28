import { NotFoundException } from '@nestjs/common';
import { CATEGORY_BY_SESSION_TYPE, ExerciseLibraryService, libraryKey } from './exercise-library.service';

function build() {
  const prisma: any = {
    exerciseLibrary: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn(),
      delete: jest.fn(),
    },
    exercise: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const cloudinary = { uploadImage: jest.fn().mockResolvedValue({ url: 'https://res.cloudinary.com/x/capa.webp' }) };
  return { service: new ExerciseLibraryService(prisma, cloudinary as any), prisma, cloudinary };
}

const used = (name: string, type = 'LPO', over: Record<string, unknown> = {}) => ({
  name, youtubeUrl: null, sets: null, reps: null, duration: null, restSeconds: null, loadPercent: null, coachNotes: null,
  session: { type }, ...over,
});

describe('libraryKey', () => {
  it('ignora acento, maiúscula e espaços', () => {
    expect(libraryKey('  Elevação   Pélvica ')).toBe('elevacao pelvica');
  });
});

describe('ExerciseLibraryService.syncFromPlans', () => {
  it('busca só os exercícios dos planos DO PRÓPRIO coach, mais recentes primeiro', async () => {
    const { service, prisma } = build();
    await service.syncFromPlans('coach-1');
    expect(prisma.exercise.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { session: { day: { week: { plan: { coachId: 'coach-1' } } } } },
      orderBy: { updatedAt: 'desc' },
    }));
    expect(prisma.exerciseLibrary.findMany).toHaveBeenCalledWith({ where: { coachId: 'coach-1' }, select: { name: true } });
  });

  it('importa os que faltam, com os dados do uso mais recente e o grupo pelo tipo da sessão', async () => {
    const { service, prisma } = build();
    prisma.exercise.findMany.mockResolvedValue([
      used('Snatch', 'LPO', { youtubeUrl: 'https://youtu.be/abcdefghijk', sets: 5, reps: '3', loadPercent: 80, coachNotes: 'foco na puxada' }),
      used('snatch ', 'LPO', { sets: 1 }), // uso mais antigo do mesmo nome: ignorado
      used('Back Squat', 'Strength', { restSeconds: 120 }),
    ]);

    await expect(service.syncFromPlans('coach-1')).resolves.toBe(2);

    expect(prisma.exerciseLibrary.createMany).toHaveBeenCalledWith({ data: [
      expect.objectContaining({
        coachId: 'coach-1', name: 'Snatch', youtubeUrl: 'https://youtu.be/abcdefghijk', sets: 5, reps: '3',
        loadPercent: 80, notes: 'foco na puxada', category: 'LPO', autoImported: true,
      }),
      expect.objectContaining({ name: 'Back Squat', category: 'Força', restSeconds: 120, autoImported: true }),
    ] });
  });

  it('não duplica o que já está na biblioteca (inclusive oculto), sem diferenciar acento/maiúscula', async () => {
    const { service, prisma } = build();
    prisma.exerciseLibrary.findMany.mockResolvedValue([{ name: 'SNATCH' }, { name: 'Elevação Pélvica' }]);
    prisma.exercise.findMany.mockResolvedValue([used('snatch'), used('Elevacao pelvica', 'Core')]);
    await expect(service.syncFromPlans('coach-1')).resolves.toBe(0);
    expect(prisma.exerciseLibrary.createMany).not.toHaveBeenCalled();
  });

  it('nome vazio/só espaços é ignorado', async () => {
    const { service, prisma } = build();
    prisma.exercise.findMany.mockResolvedValue([used('   ')]);
    await expect(service.syncFromPlans('coach-1')).resolves.toBe(0);
  });

  it('mapeia todos os tipos de sessão pra um grupo da biblioteca', () => {
    expect(Object.values(CATEGORY_BY_SESSION_TYPE)).toEqual(['LPO', 'Força', 'Ginástica', 'Metcon', 'Resistência', 'Mobilidade', 'Core']);
  });
});

describe('ExerciseLibraryService', () => {
  it('findAll: sincroniza antes e lista só os visíveis, ordenados por categoria e nome', async () => {
    const { service, prisma } = build();
    prisma.exerciseLibrary.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'i1' }]);
    await expect(service.findAll('coach-1')).resolves.toEqual([{ id: 'i1' }]);
    expect(prisma.exercise.findMany).toHaveBeenCalled();
    expect(prisma.exerciseLibrary.findMany).toHaveBeenLastCalledWith({
      where: { coachId: 'coach-1', hidden: false }, orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  });

  it('findOne: escopado por coachId e só visíveis — item de outro coach (ou oculto) não é encontrado', async () => {
    const { service, prisma } = build();
    prisma.exerciseLibrary.findFirst.mockResolvedValue(null);
    await expect(service.findOne('item-1', 'coach-1')).rejects.toThrow(NotFoundException);
    expect(prisma.exerciseLibrary.findFirst).toHaveBeenCalledWith({ where: { id: 'item-1', coachId: 'coach-1', hidden: false } });
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

  it('update: confere o dono antes de atualizar', async () => {
    const { service, prisma } = build();
    prisma.exerciseLibrary.findFirst.mockResolvedValue({ id: 'item-1' });
    await service.update('item-1', 'coach-1', { sets: 4 } as never);
    expect(prisma.exerciseLibrary.update).toHaveBeenCalledWith({ where: { id: 'item-1' }, data: { sets: 4 } });
  });

  it('update de item de outro coach: 404, nada é alterado', async () => {
    const { service, prisma } = build();
    prisma.exerciseLibrary.findFirst.mockResolvedValue(null);
    await expect(service.update('item-x', 'coach-1', {} as never)).rejects.toThrow(NotFoundException);
    expect(prisma.exerciseLibrary.update).not.toHaveBeenCalled();
  });

  it('remove de item importado: só oculta (não volta na próxima sincronização)', async () => {
    const { service, prisma } = build();
    prisma.exerciseLibrary.findFirst.mockResolvedValue({ id: 'item-1', autoImported: true });
    await service.remove('item-1', 'coach-1');
    expect(prisma.exerciseLibrary.update).toHaveBeenCalledWith({ where: { id: 'item-1' }, data: { hidden: true } });
    expect(prisma.exerciseLibrary.delete).not.toHaveBeenCalled();
  });

  it('remove de item cadastrado à mão: apaga de verdade', async () => {
    const { service, prisma } = build();
    prisma.exerciseLibrary.findFirst.mockResolvedValue({ id: 'item-1', autoImported: false });
    await service.remove('item-1', 'coach-1');
    expect(prisma.exerciseLibrary.delete).toHaveBeenCalledWith({ where: { id: 'item-1' } });
  });

  it('remove de item de outro coach: 404, nada é apagado', async () => {
    const { service, prisma } = build();
    prisma.exerciseLibrary.findFirst.mockResolvedValue(null);
    await expect(service.remove('item-x', 'coach-1')).rejects.toThrow(NotFoundException);
    expect(prisma.exerciseLibrary.delete).not.toHaveBeenCalled();
    expect(prisma.exerciseLibrary.update).not.toHaveBeenCalled();
  });
});

describe('ExerciseLibraryService — capa do exercício', () => {
  it('uploadImage: confere o dono, sobe numa pasta do coach e grava a URL', async () => {
    const { service, prisma, cloudinary } = build();
    prisma.exerciseLibrary.findFirst.mockResolvedValue({ id: 'item-1' });
    const buf = Buffer.from('img');
    await service.uploadImage('item-1', 'coach-1', buf);
    expect(prisma.exerciseLibrary.findFirst).toHaveBeenCalledWith({ where: { id: 'item-1', coachId: 'coach-1', hidden: false } });
    expect(cloudinary.uploadImage).toHaveBeenCalledWith(buf, 'pulserx/exercise-library/coach-1');
    expect(prisma.exerciseLibrary.update).toHaveBeenCalledWith({ where: { id: 'item-1' }, data: { imageUrl: 'https://res.cloudinary.com/x/capa.webp' } });
  });

  it('uploadImage em item de outro coach: 404 e nada é enviado ao Cloudinary', async () => {
    const { service, prisma, cloudinary } = build();
    prisma.exerciseLibrary.findFirst.mockResolvedValue(null);
    await expect(service.uploadImage('item-x', 'coach-1', Buffer.from('x'))).rejects.toThrow(NotFoundException);
    expect(cloudinary.uploadImage).not.toHaveBeenCalled();
    expect(prisma.exerciseLibrary.update).not.toHaveBeenCalled();
  });

  it('removeImage: confere o dono e limpa a URL; de outro coach dá 404', async () => {
    const { service, prisma } = build();
    prisma.exerciseLibrary.findFirst.mockResolvedValueOnce({ id: 'item-1' }).mockResolvedValueOnce(null);
    await service.removeImage('item-1', 'coach-1');
    expect(prisma.exerciseLibrary.update).toHaveBeenCalledWith({ where: { id: 'item-1' }, data: { imageUrl: null } });
    await expect(service.removeImage('item-x', 'coach-1')).rejects.toThrow(NotFoundException);
  });
});

