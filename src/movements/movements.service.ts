import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMovementDto } from './dto/create-movement.dto';

type AuthUser = { id: string; role: string };

/** Teto de movimentos próprios por atleta — freio contra encher o catálogo (o throttle é por IP). */
export const MAX_ATHLETE_MOVEMENTS = 100;

/**
 * Catálogo padrão (global): movimentos clássicos pra qualquer atleta registrar PR sem depender
 * do coach. Só movimentos medidos em carga e/ou repetições (o PR não guarda tempo/distância).
 * Ids FIXOS (UUID v5 do slug do nome, gerados uma vez e colados aqui — o registro de PR exige
 * UUID) — criar de novo é no-op (`skipDuplicates`), então rodar em paralelo ou em
 * todo boot/request não duplica. Pra adicionar um item, só acrescentar aqui com id novo.
 */
export const DEFAULT_MOVEMENTS: { id: string; name: string; category: string }[] = [
  { id: '9ec94a1d-fe52-5cb7-9d77-888c6fedeebc', name: 'Snatch', category: 'LPO' },
  { id: '711db9a6-8b10-5282-8de5-851299b2ad9d', name: 'Power Snatch', category: 'LPO' },
  { id: '7ec224d5-9125-51d3-8973-144385b2295d', name: 'Hang Snatch', category: 'LPO' },
  { id: '300d3867-084e-52de-8577-f9a9d62cd8c4', name: 'Hang Power Snatch', category: 'LPO' },
  { id: 'b08cc812-2fe4-5980-bc9f-fe0c055c521b', name: 'Squat Snatch', category: 'LPO' },
  { id: 'f5b012af-7a17-5a33-9d99-332d897e4514', name: 'Snatch Balance', category: 'LPO' },
  { id: '82b8732e-5c3d-5feb-be66-9b5b16276e45', name: 'Snatch Pull', category: 'LPO' },
  { id: 'ca7ff547-70b4-53f4-9399-87d31c5c4195', name: 'Snatch Deadlift', category: 'LPO' },
  { id: '0dcbde4e-30ba-584d-862b-d2e7d65476d1', name: 'Clean', category: 'LPO' },
  { id: 'a1387265-63ac-5263-9ee9-ced9d25076f3', name: 'Power Clean', category: 'LPO' },
  { id: 'a2fd9f46-4760-5e00-8027-aeaf37f584af', name: 'Hang Clean', category: 'LPO' },
  { id: '3fb10130-480e-5d7d-b1e2-33ae1def19d7', name: 'Hang Power Clean', category: 'LPO' },
  { id: 'c63f47f2-5059-5c45-be54-8d120ac9cd0d', name: 'Squat Clean', category: 'LPO' },
  { id: 'd02ddcb3-8027-5394-b166-506f7be17d7d', name: 'Clean Pull', category: 'LPO' },
  { id: '02b2ed4a-4435-5c7a-a5c8-ba5abc3f0814', name: 'Clean & Jerk', category: 'LPO' },
  { id: '195f437d-3cee-592d-ba2a-405702aa7f8a', name: 'Split Jerk', category: 'LPO' },
  { id: '8aba6854-9b65-5ee8-af23-1c7d6be24d51', name: 'Push Jerk', category: 'LPO' },
  { id: '2c64c683-bbd7-5902-898e-459ea236bf1c', name: 'Squat Jerk', category: 'LPO' },
  { id: '7948a22a-7664-5551-9816-60b816c9d11a', name: 'Thruster', category: 'LPO' },
  { id: '0e1fa12b-c987-50f8-84c3-51759571ef3e', name: 'Back Squat', category: 'Força' },
  { id: 'f15fa1a5-9050-5d7f-87b7-8ff9fc88f26a', name: 'Front Squat', category: 'Força' },
  { id: 'a9866412-2f7c-5e20-bb12-da00d4f961d6', name: 'Overhead Squat', category: 'Força' },
  { id: '808897c9-39d9-5d0e-893b-13fa5c26efa1', name: 'Box Squat', category: 'Força' },
  { id: '28d74079-33dc-523d-934c-aee15617b15f', name: 'Pause Back Squat', category: 'Força' },
  { id: '6da80a18-0108-5458-bf5f-0519d23a7a54', name: 'Deadlift', category: 'Força' },
  { id: 'a315a02a-6db3-54c3-8142-cc3c684c314c', name: 'Sumo Deadlift', category: 'Força' },
  { id: '3a6c64aa-e6d1-50fa-aa1b-350a2f7c6dee', name: 'Romanian Deadlift', category: 'Força' },
  { id: '6268d42b-da22-52c8-9ea0-339b1c29fddf', name: 'Strict Press', category: 'Força' },
  { id: '282f9c70-27eb-5232-93b6-6da24db0eb04', name: 'Push Press', category: 'Força' },
  { id: '6d95d910-6f19-5179-b041-76540853bca2', name: 'Bench Press', category: 'Força' },
  { id: '1ce00b3e-3955-5314-b2de-64b432e98caf', name: 'Incline Bench Press', category: 'Força' },
  { id: 'c437e8a2-6e01-5b9e-8d74-c80124eeba2e', name: 'Barbell Bent Over Row', category: 'Força' },
  { id: '49570168-c9a5-5c4c-a287-2f731619cadb', name: 'Weighted Pull-up', category: 'Força' },
  { id: 'ccd362d8-1523-5f76-9670-bef290ca2521', name: 'Weighted Dip', category: 'Força' },
  { id: '3308b44d-920a-531c-b060-4c3924b671c5', name: 'Hip Thrust', category: 'Força' },
  { id: '3ce5ceba-9126-5e54-8afd-d7d77e972889', name: 'Bulgarian Split Squat', category: 'Força' },
  { id: '6fccd615-6d41-521e-9256-ec98b5273a76', name: 'Walking Lunge', category: 'Força' },
  { id: 'f177b39b-bfca-590e-9627-c151077af968', name: 'Pull-up', category: 'Ginástica' },
  { id: '3ed99b87-35a5-5b5b-94c9-f793e29ee8a8', name: 'Chest-to-Bar Pull-up', category: 'Ginástica' },
  { id: '00f4b9ac-fb32-5300-a0d3-6d337e87c1e6', name: 'Bar Muscle-up', category: 'Ginástica' },
  { id: '214659bc-f04f-5901-a8ec-e6a49ec3f950', name: 'Ring Muscle-up', category: 'Ginástica' },
  { id: '86ec311d-f4ee-5935-9a86-13fd3ea34fc2', name: 'Handstand Push-up', category: 'Ginástica' },
  { id: '26c6e378-5545-5785-8a89-0346a003175d', name: 'Strict Handstand Push-up', category: 'Ginástica' },
  { id: 'e0a8700f-67f5-5e69-b6d1-605e186560e9', name: 'Toes-to-Bar', category: 'Ginástica' },
  { id: 'c95d1292-56c5-5d73-81d5-5b227c898179', name: 'Ring Dip', category: 'Ginástica' },
  { id: 'e41758d3-b134-5700-8042-d1d9bc550711', name: 'Push-up', category: 'Ginástica' },
  { id: 'e776fe03-57fd-56e3-8b80-22d27d7236ab', name: 'Rope Climb', category: 'Ginástica' },
  { id: 'd7e18de7-fad9-53fa-8d21-3324e8df7da2', name: 'Pistol Squat', category: 'Ginástica' },
  { id: '9d5b9098-4800-582d-a376-2a8f7e3297c6', name: 'GHD Sit-up', category: 'Core' },
  { id: 'f5351bcb-0db9-5cbb-a226-1581eeb7c653', name: 'Back Extension', category: 'Core' },
  { id: 'c4ffc048-f876-5090-a0d4-d2dd0e1700d3', name: 'Turkish Get-up', category: 'Core' },
  { id: 'bacedbf8-8c5a-5351-be8d-6f9ee4efbe2c', name: 'Wall Ball', category: 'Metcon' },
  { id: '90a0d8e0-512e-5ec0-b94c-7be5a8ab15ec', name: 'Kettlebell Swing', category: 'Metcon' },
  { id: 'ad61737f-93f2-5fc6-afba-116031df9761', name: 'Box Jump', category: 'Metcon' },
  { id: '410e2f2a-5fd7-536c-bfd1-6e0e4a98e582', name: 'Burpee', category: 'Metcon' },
  { id: '9dab78b0-32cd-558b-9252-3470d0e0e2b3', name: 'Double Under', category: 'Metcon' },
  { id: '0f031958-5519-5eb1-a28f-76f4e0958c54', name: 'Dumbbell Snatch', category: 'Metcon' },
  { id: 'f5cb6969-17f3-5921-9334-f17475222210', name: 'Devil Press', category: 'Metcon' },
];

@Injectable()
export class MovementsService {
  private defaultsEnsured = false;

  constructor(private prisma: PrismaService) {}

  /**
   * Catálogo visível: globais + do coach (o próprio, ou o coach do aluno) + os do próprio atleta.
   * Movimento de OUTRO atleta nunca aparece (nem pro coach dele).
   */
  async findAvailable(user: AuthUser) {
    await this.ensureDefaultMovements();
    return this.prisma.movement.findMany({
      where: await this.visibleWhere(user),
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  }

  /** Confirma que movementId está no catálogo visível pro usuário. */
  async isAvailableForUser(user: AuthUser, movementId: string): Promise<boolean> {
    const movement = await this.prisma.movement.findFirst({
      where: { id: movementId, ...(await this.visibleWhere(user)) },
      select: { id: true },
    });
    return movement != null;
  }

  /**
   * Coach cria no catálogo dele (alunos veem); atleta cria no próprio (só ele vê).
   * Nome repetido (sem diferenciar maiúsculas) do que o usuário já enxerga é recusado — senão
   * "Back Squat" e "back squat" viram dois movimentos e a evolução do PR fica dividida.
   */
  async create(user: AuthUser, dto: CreateMovementDto) {
    if (user.role !== 'coach' && user.role !== 'athlete') {
      throw new ForbiddenException('Só coach ou atleta cadastram movimento.');
    }
    await this.ensureDefaultMovements();
    const name = dto.name.trim().replace(/\s+/g, ' ');
    if (!name) throw new BadRequestException('Informe o nome do movimento.');
    if (user.role === 'athlete') {
      const own = await this.prisma.movement.count({ where: { athleteId: user.id } });
      if (own >= MAX_ATHLETE_MOVEMENTS) {
        throw new BadRequestException(`Você já cadastrou ${MAX_ATHLETE_MOVEMENTS} movimentos próprios, o máximo permitido.`);
      }
    }
    const duplicate = await this.prisma.movement.findFirst({
      where: { name: { equals: name, mode: 'insensitive' }, ...(await this.visibleWhere(user)) },
      select: { id: true },
    });
    if (duplicate) throw new ConflictException('Já existe um movimento com esse nome no seu catálogo.');

    return this.prisma.movement.create({
      data: user.role === 'coach'
        ? { name, category: dto.category, coachId: user.id }
        : { name, category: dto.category, athleteId: user.id },
    });
  }

  /** Cria o catálogo padrão se faltar algum item (uma vez por processo; idempotente no banco). */
  async ensureDefaultMovements(): Promise<void> {
    if (this.defaultsEnsured) return;
    await this.prisma.movement.createMany({ data: DEFAULT_MOVEMENTS, skipDuplicates: true });
    this.defaultsEnsured = true;
  }

  private async visibleWhere(user: AuthUser): Promise<Prisma.MovementWhereInput> {
    const global: Prisma.MovementWhereInput = { coachId: null, athleteId: null };
    if (user.role === 'coach') {
      return { OR: [global, { coachId: user.id }] };
    }
    if (user.role === 'athlete') {
      const student = await this.prisma.student.findFirst({
        where: { userId: user.id },
        select: { coachId: true },
      });
      const or: Prisma.MovementWhereInput[] = [global, { athleteId: user.id }];
      if (student?.coachId) or.push({ coachId: student.coachId });
      return { OR: or };
    }
    return global;
  }
}
