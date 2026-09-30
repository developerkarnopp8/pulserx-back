import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PlanAccessService } from './plan-access.service';
import { SubscriptionAccessService } from './subscription-access.service';
import { PrismaService } from '../prisma/prisma.service';

describe('PlanAccessService', () => {
  let service: PlanAccessService;
  let prisma: any;
  let subscriptionAccess: { assertCanAccessCategory: jest.Mock };

  const coach = { id: 'coach-1', role: 'coach' };
  const outroCoach = { id: 'coach-9', role: 'coach' };
  const atleta = { id: 'athlete-1', role: 'athlete' };

  const individual = {
    id: 'plan-i', coachId: 'coach-1', scope: 'INDIVIDUAL', category: 'PERFORMANCE', published: true,
    student: { id: 'student-1', userId: 'athlete-1' },
  };
  const shared = {
    id: 'plan-s', coachId: 'coach-1', scope: 'SHARED', category: 'CORE', published: true, student: null,
  };

  beforeEach(async () => {
    prisma = {
      trainingPlan: { findUnique: jest.fn() },
      student: { findFirst: jest.fn() },
      session: { findUnique: jest.fn() },
      exercise: { findUnique: jest.fn() },
    };
    subscriptionAccess = { assertCanAccessCategory: jest.fn().mockResolvedValue(undefined) };
    const module = await Test.createTestingModule({
      providers: [
        PlanAccessService,
        { provide: PrismaService, useValue: prisma },
        { provide: SubscriptionAccessService, useValue: subscriptionAccess },
      ],
    }).compile();
    service = module.get(PlanAccessService);
  });

  it('404 quando o plano não existe', async () => {
    prisma.trainingPlan.findUnique.mockResolvedValue(null);
    await expect(service.resolveByPlanId('x', coach)).rejects.toThrow(NotFoundException);
  });

  describe('coach', () => {
    it('dono do plano individual: acesso, com o progresso do aluno', async () => {
      prisma.trainingPlan.findUnique.mockResolvedValue(individual);
      await expect(service.resolveByPlanId('plan-i', coach)).resolves.toEqual(
        expect.objectContaining({ isCoach: true, studentId: 'student-1', athleteId: 'athlete-1', coachId: 'coach-1' }),
      );
    });

    it('dono do plano compartilhado: acesso, sem aluno nem progresso', async () => {
      prisma.trainingPlan.findUnique.mockResolvedValue(shared);
      await expect(service.resolveByPlanId('plan-s', coach)).resolves.toEqual(
        expect.objectContaining({ isCoach: true, studentId: null, athleteId: null, scope: 'SHARED', category: 'CORE' }),
      );
    });

    it('plano individual de aluno desvinculado (ou com a conta excluída): 404 para o coach e para o aluno', async () => {
      const exAluno = { ...individual, student: { ...individual.student, unlinkedAt: new Date() } };
      prisma.trainingPlan.findUnique.mockResolvedValue(exAluno);
      await expect(service.resolveByPlanId('plan-i', coach)).rejects.toThrow(NotFoundException);
      await expect(service.resolveByPlanId('plan-i', atleta)).rejects.toThrow(NotFoundException);
      expect(prisma.trainingPlan.findUnique.mock.calls[0][0].select.student).toEqual({
        select: { id: true, userId: true, unlinkedAt: true },
      });
    });

    it('IDOR: outro coach é barrado em plano individual e em compartilhado', async () => {
      prisma.trainingPlan.findUnique.mockResolvedValueOnce(individual);
      await expect(service.resolveByPlanId('plan-i', outroCoach)).rejects.toThrow(ForbiddenException);
      prisma.trainingPlan.findUnique.mockResolvedValueOnce(shared);
      await expect(service.resolveByPlanId('plan-s', outroCoach)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('atleta — plano individual', () => {
    it('o próprio aluno acessa, conferindo a categoria na assinatura', async () => {
      prisma.trainingPlan.findUnique.mockResolvedValue(individual);
      await expect(service.resolveByPlanId('plan-i', atleta)).resolves.toEqual(
        expect.objectContaining({ isCoach: false, studentId: 'student-1', athleteId: 'athlete-1' }),
      );
      expect(subscriptionAccess.assertCanAccessCategory).toHaveBeenCalledWith('student-1', 'PERFORMANCE');
    });

    it('IDOR: outro aluno é barrado', async () => {
      prisma.trainingPlan.findUnique.mockResolvedValue(individual);
      await expect(service.resolveByPlanId('plan-i', { id: 'athlete-2', role: 'athlete' })).rejects.toThrow(ForbiddenException);
      expect(subscriptionAccess.assertCanAccessCategory).not.toHaveBeenCalled();
    });

    it('categoria não liberada pela assinatura: propaga o 403', async () => {
      prisma.trainingPlan.findUnique.mockResolvedValue(individual);
      subscriptionAccess.assertCanAccessCategory.mockRejectedValue(new ForbiddenException('Seu plano não inclui esta categoria de treino.'));
      await expect(service.resolveByPlanId('plan-i', atleta)).rejects.toThrow('Seu plano não inclui');
    });

    it('estado inconsistente (individual sem aluno) falha fechado', async () => {
      prisma.trainingPlan.findUnique.mockResolvedValue({ ...individual, student: null });
      await expect(service.resolveByPlanId('plan-i', atleta)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('atleta — plano compartilhado', () => {
    it('aluno do coach dono, plano publicado e categoria liberada: acesso, progresso é o dele', async () => {
      prisma.trainingPlan.findUnique.mockResolvedValue(shared);
      prisma.student.findFirst.mockResolvedValue({ id: 'student-1' });

      await expect(service.resolveByPlanId('plan-s', atleta)).resolves.toEqual(
        expect.objectContaining({ isCoach: false, studentId: 'student-1', athleteId: 'athlete-1', coachId: 'coach-1' }),
      );
      expect(prisma.student.findFirst).toHaveBeenCalledWith({
        where: { userId: 'athlete-1', coachId: 'coach-1', unlinkedAt: null },
        select: { id: true },
      });
      expect(subscriptionAccess.assertCanAccessCategory).toHaveBeenCalledWith('student-1', 'CORE');
    });

    it('IDOR: aluno de OUTRO coach é barrado', async () => {
      prisma.trainingPlan.findUnique.mockResolvedValue(shared);
      prisma.student.findFirst.mockResolvedValue(null);
      await expect(service.resolveByPlanId('plan-s', atleta)).rejects.toThrow(ForbiddenException);
      expect(subscriptionAccess.assertCanAccessCategory).not.toHaveBeenCalled();
    });

    it('rascunho (não publicado) não é visível ao aluno, nem consulta o vínculo', async () => {
      prisma.trainingPlan.findUnique.mockResolvedValue({ ...shared, published: false });
      await expect(service.resolveByPlanId('plan-s', atleta)).rejects.toThrow(ForbiddenException);
      expect(prisma.student.findFirst).not.toHaveBeenCalled();
    });

    it('aluno sem a categoria na assinatura: propaga o 403', async () => {
      prisma.trainingPlan.findUnique.mockResolvedValue(shared);
      prisma.student.findFirst.mockResolvedValue({ id: 'student-1' });
      subscriptionAccess.assertCanAccessCategory.mockRejectedValue(new ForbiddenException('Seu plano não inclui esta categoria de treino.'));
      await expect(service.resolveByPlanId('plan-s', atleta)).rejects.toThrow('Seu plano não inclui');
    });
  });

  it('outros papéis (admin, juiz…) são barrados — falha fechada', async () => {
    prisma.trainingPlan.findUnique.mockResolvedValue(shared);
    await expect(service.resolveByPlanId('plan-s', { id: 'admin-1', role: 'admin' })).rejects.toThrow(ForbiddenException);
  });

  it('resolveBySessionId resolve o plano da sessão e aplica as mesmas regras', async () => {
    prisma.session.findUnique.mockResolvedValue({ day: { week: { planId: 'plan-s' } } });
    prisma.trainingPlan.findUnique.mockResolvedValue(shared);
    await expect(service.resolveBySessionId('sess-1', outroCoach)).rejects.toThrow(ForbiddenException);
    await expect(service.resolveBySessionId('sess-1', coach)).resolves.toEqual(expect.objectContaining({ planId: 'plan-s' }));
    expect(prisma.trainingPlan.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'plan-s' } }));
  });

  it('resolveBySessionId: 404 quando a sessão não existe', async () => {
    prisma.session.findUnique.mockResolvedValue(null);
    await expect(service.resolveBySessionId('x', coach)).rejects.toThrow(NotFoundException);
  });

  it('resolveByExerciseId resolve o plano do exercício e aplica as mesmas regras', async () => {
    prisma.exercise.findUnique.mockResolvedValue({ session: { day: { week: { planId: 'plan-i' } } } });
    prisma.trainingPlan.findUnique.mockResolvedValue(individual);
    await expect(service.resolveByExerciseId('ex-1', { id: 'athlete-2', role: 'athlete' })).rejects.toThrow(ForbiddenException);
    await expect(service.resolveByExerciseId('ex-1', atleta)).resolves.toEqual(expect.objectContaining({ planId: 'plan-i' }));
  });

  it('resolveByExerciseId: 404 quando o exercício não existe', async () => {
    prisma.exercise.findUnique.mockResolvedValue(null);
    await expect(service.resolveByExerciseId('x', atleta)).rejects.toThrow(NotFoundException);
  });
});
