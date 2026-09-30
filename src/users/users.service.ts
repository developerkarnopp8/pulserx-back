import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  /** Registra o último login com senha (painel do admin, "uso por coach"). */
  async markLogin(id: string, now = new Date()): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { lastLoginAt: now }, select: { id: true } });
  }

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, role: true, createdAt: true, updatedAt: true },
    });
    if (!user) throw new NotFoundException('Usuário não encontrado');
    return user;
  }

  async findAll() {
    const users = await this.prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    });
    return users;
  }
}
