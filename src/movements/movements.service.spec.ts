import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { DEFAULT_MOVEMENTS, MAX_ATHLETE_MOVEMENTS, MovementsService } from './movements.service';

const GLOBAL = { coachId: null, athleteId: null };

function build(student: { coachId: string } | null = { coachId: 'coach-9' }) {
  const prisma: any = {
    movement: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'novo', ...data })),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      count: jest.fn().mockResolvedValue(0),
    },
    student: { findFirst: jest.fn().mockResolvedValue(student) },
  };
  return { service: new MovementsService(prisma), prisma };
}

describe('MovementsService — catálogo padrão', () => {
  it('ids fixos e únicos, nomes únicos, categorias válidas do DTO', () => {
    const ids = DEFAULT_MOVEMENTS.map(m => m.id);
    const names = DEFAULT_MOVEMENTS.map(m => m.name.toLowerCase());
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
    expect(DEFAULT_MOVEMENTS.every(m => ['LPO', 'Força', 'Ginástica', 'Metcon', 'Resistência', 'Mobilidade', 'Core', 'Outro'].includes(m.category))).toBe(true);
  });

  it('todo id é UUID válido (o registro de PR valida movementId com @IsUUID)', () => {
    expect(DEFAULT_MOVEMENTS.every(m => isUUID(m.id))).toBe(true);
  });

  it('cria com skipDuplicates (idempotente) e só uma vez por processo', async () => {
    const { service, prisma } = build();
    await service.findAvailable({ id: 'coach-1', role: 'coach' });
    await service.findAvailable({ id: 'coach-1', role: 'coach' });
    expect(prisma.movement.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.movement.createMany).toHaveBeenCalledWith({ data: DEFAULT_MOVEMENTS, skipDuplicates: true });
  });

  it('se criar falhar, tenta de novo na próxima chamada', async () => {
    const { service, prisma } = build();
    prisma.movement.createMany.mockRejectedValueOnce(new Error('db'));
    await expect(service.ensureDefaultMovements()).rejects.toThrow('db');
    await service.ensureDefaultMovements();
    expect(prisma.movement.createMany).toHaveBeenCalledTimes(2);
  });
});

describe('MovementsService.findAvailable — quem vê o quê', () => {
  it('coach: globais + os dele (sem movimento de atleta)', async () => {
    const { service, prisma } = build();
    await service.findAvailable({ id: 'coach-1', role: 'coach' });
    expect(prisma.movement.findMany).toHaveBeenCalledWith({
      where: { OR: [GLOBAL, { coachId: 'coach-1' }] },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
    expect(prisma.student.findFirst).not.toHaveBeenCalled();
  });

  it('atleta: globais + os próprios + os do coach dele', async () => {
    const { service, prisma } = build({ coachId: 'coach-9' });
    await service.findAvailable({ id: 'athlete-1', role: 'athlete' });
    expect(prisma.student.findFirst).toHaveBeenCalledWith({ where: { userId: 'athlete-1' }, select: { coachId: true } });
    expect(prisma.movement.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: [GLOBAL, { athleteId: 'athlete-1' }, { coachId: 'coach-9' }] },
    }));
  });

  it('atleta sem perfil de aluno: globais + os próprios (nunca coachId null solto)', async () => {
    const { service, prisma } = build(null);
    await service.findAvailable({ id: 'athlete-1', role: 'athlete' });
    expect(prisma.movement.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: [GLOBAL, { athleteId: 'athlete-1' }] },
    }));
  });

  it('outro papel (admin): só globais', async () => {
    const { service, prisma } = build();
    await service.findAvailable({ id: 'admin-1', role: 'admin' });
    expect(prisma.movement.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: GLOBAL }));
  });
});

describe('MovementsService.isAvailableForUser', () => {
  it('atleta: busca o id dentro do catálogo visível dele', async () => {
    const { service, prisma } = build({ coachId: 'coach-9' });
    prisma.movement.findFirst.mockResolvedValue({ id: 'mov-1' });
    await expect(service.isAvailableForUser({ id: 'athlete-1', role: 'athlete' }, 'mov-1')).resolves.toBe(true);
    expect(prisma.movement.findFirst).toHaveBeenCalledWith({
      where: { id: 'mov-1', OR: [GLOBAL, { athleteId: 'athlete-1' }, { coachId: 'coach-9' }] },
      select: { id: true },
    });
  });

  it('movimento de OUTRO atleta ou de outro coach: false (não registra PR nele)', async () => {
    const { service } = build();
    await expect(service.isAvailableForUser({ id: 'athlete-1', role: 'athlete' }, 'mov-de-outro')).resolves.toBe(false);
  });
});

describe('MovementsService.create', () => {
  it('coach cria no catálogo dele', async () => {
    const { service, prisma } = build();
    await service.create({ id: 'coach-1', role: 'coach' }, { name: 'Zercher Squat', category: 'Força' });
    expect(prisma.movement.create).toHaveBeenCalledWith({
      data: { name: 'Zercher Squat', category: 'Força', coachId: 'coach-1' },
    });
  });

  it('atleta cria no próprio catálogo (athleteId), nunca no do coach', async () => {
    const { service, prisma } = build();
    await service.create({ id: 'athlete-1', role: 'athlete' }, { name: 'Box Squat', category: 'Força' });
    expect(prisma.movement.create).toHaveBeenCalledWith({
      data: { name: 'Box Squat', category: 'Força', athleteId: 'athlete-1' },
    });
  });

  it('normaliza espaços e recusa nome repetido do que já vê (sem diferenciar maiúsculas)', async () => {
    const { service, prisma } = build({ coachId: 'coach-9' });
    prisma.movement.findFirst.mockResolvedValue({ id: 'global-back-squat' });
    await expect(service.create({ id: 'athlete-1', role: 'athlete' }, { name: '  back   squat ', category: 'Força' }))
      .rejects.toThrow(ConflictException);
    expect(prisma.movement.findFirst).toHaveBeenCalledWith({
      where: {
        name: { equals: 'back squat', mode: 'insensitive' },
        OR: [GLOBAL, { athleteId: 'athlete-1' }, { coachId: 'coach-9' }],
      },
      select: { id: true },
    });
    expect(prisma.movement.create).not.toHaveBeenCalled();
  });

  it('atleta no teto de movimentos próprios: 400 e não cria; coach não tem teto', async () => {
    const { service, prisma } = build();
    prisma.movement.count.mockResolvedValue(MAX_ATHLETE_MOVEMENTS);
    await expect(service.create({ id: 'athlete-1', role: 'athlete' }, { name: 'Novo', category: 'Força' }))
      .rejects.toThrow(BadRequestException);
    expect(prisma.movement.count).toHaveBeenCalledWith({ where: { athleteId: 'athlete-1' } });
    expect(prisma.movement.create).not.toHaveBeenCalled();

    prisma.movement.count.mockClear();
    await service.create({ id: 'coach-1', role: 'coach' }, { name: 'Novo', category: 'Força' });
    expect(prisma.movement.count).not.toHaveBeenCalled();
    expect(prisma.movement.create).toHaveBeenCalled();
  });

  it('nome só com espaços: 400', async () => {
    const { service, prisma } = build();
    await expect(service.create({ id: 'athlete-1', role: 'athlete' }, { name: '   ', category: 'Força' }))
      .rejects.toThrow(BadRequestException);
    expect(prisma.movement.create).not.toHaveBeenCalled();
  });

  it('outro papel: 403', async () => {
    const { service, prisma } = build();
    await expect(service.create({ id: 'admin-1', role: 'admin' }, { name: 'X', category: 'Força' }))
      .rejects.toThrow(ForbiddenException);
    expect(prisma.movement.create).not.toHaveBeenCalled();
  });
});
