import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { generateStrongPassword } from '../common/generate-strong-password';
import { CreateCoachDto } from './dto/admin.dto';
import { ACTIVE_STUDENT } from '../common/student-scope';

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  /**
   * Lista coaches com o real por trás da governança da plataforma: % configurada por contrato
   * (só o admin define, por coach — nunca um valor fixo global), quantos alunos ele tem, e o
   * repasse real já pago (soma de GatewayPayment com status 'paid' dos alunos dele, dividido em
   * quanto é da plataforma e quanto é do coach pela % vigente).
   */
  async listCoaches() {
    const coaches = await this.prisma.user.findMany({
      where: { role: 'coach' },
      select: { id: true, name: true, email: true, aiImportEnabled: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });

    return Promise.all(coaches.map(async coach => {
      const [contract, studentCount, paidAgg] = await Promise.all([
        this.prisma.coachContract.findUnique({ where: { coachId: coach.id }, select: { platformFeePercent: true } }),
        this.prisma.student.count({ where: { coachId: coach.id, ...ACTIVE_STUDENT } }),
        this.prisma.gatewayPayment.aggregate({
          where: { status: 'paid', subscription: { student: { coachId: coach.id } } },
          _sum: { amount: true },
        }),
      ]);

      const platformFeePercent = contract ? Number(contract.platformFeePercent) : 0;
      const totalPaid = paidAgg._sum.amount ?? 0;
      const platformCut = Math.round(totalPaid * platformFeePercent) / 100;
      const coachCut = totalPaid - platformCut;

      return { ...coach, platformFeePercent, studentCount, totalPaid, platformCut, coachCut };
    }));
  }

  async createCoach(dto: CreateCoachDto): Promise<{ id: string; name: string; email: string; password: string }> {
    const existing = await this.prisma.user.findFirst({ where: { email: dto.email } });
    if (existing) throw new ConflictException('E-mail já cadastrado');

    const password = generateStrongPassword();
    const coach = await this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        passwordHash: await bcrypt.hash(password, 10),
        role: 'coach',
      },
    });

    return { id: coach.id, name: coach.name, email: coach.email, password };
  }

  async resetCoachPassword(id: string): Promise<{ password: string }> {
    const user = await this.prisma.user.findUnique({ where: { id }, select: { role: true } });
    if (!user || user.role !== 'coach') throw new NotFoundException('Coach não encontrado');

    const password = generateStrongPassword();
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash: await bcrypt.hash(password, 10) },
    });

    return { password };
  }

  async toggleCoachAi(id: string, aiImportEnabled: boolean): Promise<{ id: string; aiImportEnabled: boolean }> {
    const user = await this.prisma.user.findUnique({ where: { id }, select: { role: true } });
    if (!user || user.role !== 'coach') throw new NotFoundException('Coach não encontrado');

    return this.prisma.user.update({
      where: { id },
      data: { aiImportEnabled },
      select: { id: true, aiImportEnabled: true },
    });
  }
}
