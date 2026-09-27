import { ConflictException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';

function build() {
  const prisma = {
    user: { findUnique: jest.fn(), create: jest.fn(), findMany: jest.fn() },
  };
  const service = new UsersService(prisma as unknown as PrismaService);
  return { service, prisma };
}

describe('UsersService.findByEmail', () => {
  it('repassa pro prisma por email', async () => {
    const { service, prisma } = build();
    prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
    await expect(service.findByEmail('ana@example.com')).resolves.toEqual({ id: 'u1' });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'ana@example.com' } });
  });
});

describe('UsersService.findById', () => {
  it('devolve o usuário sem passwordHash (select explícito)', async () => {
    const { service, prisma } = build();
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', name: 'Ana' });

    await expect(service.findById('u1')).resolves.toEqual({ id: 'u1', name: 'Ana' });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'u1' },
      select: { id: true, name: true, email: true, role: true, createdAt: true, updatedAt: true },
    });
  });

  it('usuário inexistente → 404', async () => {
    const { service, prisma } = build();
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.findById('x')).rejects.toThrow(NotFoundException);
  });
});

describe('UsersService.create', () => {
  it('e-mail já cadastrado → 409, sem criar', async () => {
    const { service, prisma } = build();
    prisma.user.findUnique.mockResolvedValue({ id: 'existente' });

    await expect(service.create({ name: 'Ana', email: 'ana@example.com', password: '123456', role: 'athlete' as never })).rejects.toThrow(ConflictException);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('cria com a senha hasheada e nunca devolve passwordHash', async () => {
    const { service, prisma } = build();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockImplementation(async ({ data }: any) => ({ id: 'u1', ...data }));
    const hashSpy = jest.spyOn(bcrypt, 'hash').mockResolvedValue('$hasheada' as never);

    const result = await service.create({ name: 'Ana', email: 'ana@example.com', password: 'senha123', role: 'coach' as never });

    expect(hashSpy).toHaveBeenCalledWith('senha123', 10);
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: { name: 'Ana', email: 'ana@example.com', passwordHash: '$hasheada', role: 'coach' },
    });
    expect(result).not.toHaveProperty('passwordHash');
    expect(result).toEqual({ id: 'u1', name: 'Ana', email: 'ana@example.com', role: 'coach' });
  });
});

describe('UsersService.findAll', () => {
  it('lista com select restrito (sem passwordHash)', async () => {
    const { service, prisma } = build();
    prisma.user.findMany.mockResolvedValue([{ id: 'u1' }]);

    await expect(service.findAll()).resolves.toEqual([{ id: 'u1' }]);
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    });
  });
});
