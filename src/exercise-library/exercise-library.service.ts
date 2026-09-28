import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SessionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryService } from '../common/cloudinary.service';
import { CreateExerciseLibraryDto, UpdateExerciseLibraryDto } from './dto/exercise-library.dto';

/** Grupo da biblioteca a partir do tipo da sessão onde o exercício foi usado. */
export const CATEGORY_BY_SESSION_TYPE: Record<SessionType, string> = {
  LPO: 'LPO',
  Strength: 'Força',
  Gymnastics: 'Ginástica',
  Metcon: 'Metcon',
  Endurance: 'Resistência',
  Mobility: 'Mobilidade',
  Core: 'Core',
};

/** Chave de comparação por nome: sem acento, minúsculo, espaços colapsados. */
export function libraryKey(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

@Injectable()
export class ExerciseLibraryService {
  constructor(private prisma: PrismaService, private cloudinary: CloudinaryService) {}

  /** Lista a biblioteca já sincronizada com os planos do coach (sem os que ele excluiu). */
  async findAll(coachId: string) {
    await this.syncFromPlans(coachId);
    return this.prisma.exerciseLibrary.findMany({
      where: { coachId, hidden: false },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  }

  /**
   * Traz pra biblioteca todo exercício dos planos DO PRÓPRIO coach que ainda não está lá (por
   * nome, sem acento/maiúscula). Usa os dados do uso mais recente (vídeo, séries, carga…).
   * Nunca altera item existente — nem o que o coach editou, nem o que ele excluiu (fica `hidden`).
   * Retorna quantos foram importados.
   */
  async syncFromPlans(coachId: string): Promise<number> {
    const [used, existing] = await Promise.all([
      this.prisma.exercise.findMany({
        where: { session: { day: { week: { plan: { coachId } } } } },
        select: {
          name: true, youtubeUrl: true, sets: true, reps: true, duration: true,
          restSeconds: true, loadPercent: true, coachNotes: true,
          session: { select: { type: true } },
        },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.exerciseLibrary.findMany({ where: { coachId }, select: { name: true } }),
    ]);

    const known = new Set(existing.map(e => libraryKey(e.name)));
    const toCreate: Prisma.ExerciseLibraryCreateManyInput[] = [];
    for (const ex of used) {
      const key = libraryKey(ex.name);
      if (!key || known.has(key)) continue; // mais recente vence: o 1º de cada nome (orderBy desc)
      known.add(key);
      toCreate.push({
        coachId,
        name: ex.name.trim(),
        youtubeUrl: ex.youtubeUrl,
        sets: ex.sets,
        reps: ex.reps,
        duration: ex.duration,
        restSeconds: ex.restSeconds,
        loadPercent: ex.loadPercent,
        notes: ex.coachNotes,
        category: CATEGORY_BY_SESSION_TYPE[ex.session.type],
        autoImported: true,
      });
    }
    if (!toCreate.length) return 0;
    await this.prisma.exerciseLibrary.createMany({ data: toCreate });
    return toCreate.length;
  }

  async findOne(id: string, coachId: string) {
    const item = await this.prisma.exerciseLibrary.findFirst({ where: { id, coachId, hidden: false } });
    if (!item) throw new NotFoundException('Exercício não encontrado');
    return item;
  }

  create(coachId: string, dto: CreateExerciseLibraryDto) {
    return this.prisma.exerciseLibrary.create({ data: { ...dto, coachId } });
  }

  async update(id: string, coachId: string, dto: UpdateExerciseLibraryDto) {
    await this.findOne(id, coachId);
    return this.prisma.exerciseLibrary.update({ where: { id }, data: dto });
  }

  /** Capa do exercício: só do próprio coach (findOne escopa pelo coachId), pasta por coach no Cloudinary. */
  async uploadImage(id: string, coachId: string, buffer: Buffer) {
    await this.findOne(id, coachId);
    const { url } = await this.cloudinary.uploadImage(buffer, `pulserx/exercise-library/${coachId}`);
    return this.prisma.exerciseLibrary.update({ where: { id }, data: { imageUrl: url } });
  }

  async removeImage(id: string, coachId: string) {
    await this.findOne(id, coachId);
    return this.prisma.exerciseLibrary.update({ where: { id }, data: { imageUrl: null } });
  }

  /** Importado automaticamente → só oculta (senão voltaria na próxima sincronização); manual → apaga. */
  async remove(id: string, coachId: string) {
    const item = await this.findOne(id, coachId);
    if (item.autoImported) {
      return this.prisma.exerciseLibrary.update({ where: { id }, data: { hidden: true } });
    }
    return this.prisma.exerciseLibrary.delete({ where: { id } });
  }
}
