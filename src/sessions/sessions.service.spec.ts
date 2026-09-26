import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { SessionsService } from './sessions.service';
import { PrismaService } from '../prisma/prisma.service';
import { PlanAccessService } from '../subscriptions/plan-access.service';

/**
 * GET /sessions/:id: a autorização vem do PlanAccessService (individual ou compartilhado) e o
 * `workoutSkips` (nível sessão e exercício) é sempre filtrado por um athleteId — nunca traz o de
 * outro aluno (achados 1/7 da revisão original).
 */
describe('SessionsService.findById', () => {
  let service: SessionsService;
  let prisma: any;
  let planAccess: { resolveBySessionId: jest.Mock };

  beforeEach(async () => {
    prisma = { session: { findUnique: jest.fn().mockResolvedValue({ id: 'sess-1' }) } };
    planAccess = { resolveBySessionId: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        SessionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: PlanAccessService, useValue: planAccess },
      ],
    }).compile();
    service = module.get(SessionsService);
  });

  const skipsFilteredBy = (athleteId: string) =>
    expect.objectContaining({
      include: expect.objectContaining({
        workoutSkips: expect.objectContaining({ where: { athleteId } }),
        exercises: expect.objectContaining({
          include: expect.objectContaining({
            workoutSkips: expect.objectContaining({ where: { athleteId } }),
          }),
        }),
      }),
    });

  it('filtra os skips pelo aluno que executa quando é o próprio aluno', async () => {
    planAccess.resolveBySessionId.mockResolvedValue({ athleteId: 'athlete-1' });

    await service.findById('sess-1', { id: 'athlete-1', role: 'athlete' });

    expect(planAccess.resolveBySessionId).toHaveBeenCalledWith('sess-1', { id: 'athlete-1', role: 'athlete' });
    expect(prisma.session.findUnique).toHaveBeenCalledWith(skipsFilteredBy('athlete-1'));
  });

  it('usa o athleteId do dono do plano individual (não o id do coach) quando é o coach que consulta', async () => {
    planAccess.resolveBySessionId.mockResolvedValue({ athleteId: 'athlete-1' });

    await service.findById('sess-1', { id: 'coach-1', role: 'coach' });

    expect(prisma.session.findUnique).toHaveBeenCalledWith(skipsFilteredBy('athlete-1'));
  });

  it('coach num plano compartilhado (sem aluno): filtra pelo próprio id, nunca sem filtro', async () => {
    planAccess.resolveBySessionId.mockResolvedValue({ athleteId: null });

    await service.findById('sess-1', { id: 'coach-1', role: 'coach' });

    expect(prisma.session.findUnique).toHaveBeenCalledWith(skipsFilteredBy('coach-1'));
  });

  it('propaga Forbidden sem ler a sessão (não é o coach dono, dono do individual, nem aluno com a categoria)', async () => {
    planAccess.resolveBySessionId.mockRejectedValue(new ForbiddenException());

    await expect(service.findById('sess-1', { id: 'intruso', role: 'athlete' })).rejects.toThrow(ForbiddenException);
    expect(prisma.session.findUnique).not.toHaveBeenCalled();
  });

  it('propaga NotFound quando a sessão não existe', async () => {
    planAccess.resolveBySessionId.mockRejectedValue(new NotFoundException());

    await expect(service.findById('x', { id: 'athlete-1', role: 'athlete' })).rejects.toThrow(NotFoundException);
  });

  it('lança NotFound se a sessão sumir entre a checagem e a leitura', async () => {
    planAccess.resolveBySessionId.mockResolvedValue({ athleteId: 'athlete-1' });
    prisma.session.findUnique.mockResolvedValue(null);

    await expect(service.findById('sess-1', { id: 'athlete-1', role: 'athlete' })).rejects.toThrow(NotFoundException);
  });
});
