import { CoachContractsService } from './coach-contracts.service';

/** Wallet ID no formato do Asaas (UUID). */
const W = 'c0c1688f-636b-42c0-b6ee-7339182276b7';

function build(over: { user?: any; contract?: any } = {}) {
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue('user' in over ? over.user : { role: 'coach' }) },
    coachContract: {
      findUnique: jest.fn().mockResolvedValue('contract' in over ? over.contract : null),
      upsert: jest.fn().mockImplementation(async ({ create }) => ({ ...create, platformFeePercent: create.platformFeePercent })),
    },
  };
  return { service: new CoachContractsService(prisma as any), prisma };
}

describe('CoachContractsService', () => {
  it('sem contrato cadastrado → 0%', async () => {
    await expect(build().service.get('coach-1')).resolves.toEqual({ coachId: 'coach-1', platformFeePercent: 0 });
  });

  it('devolve a % como número (o Decimal do Prisma vira string no JSON) e nada além disso', async () => {
    const { service } = build({ contract: { platformFeePercent: '12.50', gateway: 'ASAAS', gatewayAccountRef: 'wallet-secreta' } });
    const result = await service.get('coach-1');
    expect(result).toEqual({ coachId: 'coach-1', platformFeePercent: 12.5 });
    expect(result).not.toHaveProperty('gatewayAccountRef');
    expect(result).not.toHaveProperty('gateway');
  });

  it('define a % por contrato (upsert) e devolve só coachId + % ', async () => {
    const { service, prisma } = build();
    await expect(service.setFee('coach-1', 20)).resolves.toEqual({ coachId: 'coach-1', platformFeePercent: 20 });
    expect(prisma.coachContract.upsert).toHaveBeenCalledWith({
      where: { coachId: 'coach-1' },
      create: { coachId: 'coach-1', platformFeePercent: 20 },
      update: { platformFeePercent: 20 },
    });
  });

  it('só coach tem contrato: outro papel ou id inexistente → 404 e nada é gravado', async () => {
    const athlete = build({ user: { role: 'athlete' } });
    await expect(athlete.service.setFee('u1', 10)).rejects.toThrow('Coach não encontrado');
    await expect(athlete.service.get('u1')).rejects.toThrow('Coach não encontrado');
    expect(athlete.prisma.coachContract.upsert).not.toHaveBeenCalled();

    const missing = build({ user: null });
    await expect(missing.service.setFee('x', 10)).rejects.toThrow('Coach não encontrado');
  });

  describe('getWallet', () => {
    it('sem contrato cadastrado: walletId null', async () => {
      await expect(build().service.getWallet('coach-1')).resolves.toEqual({ walletId: null, valid: false });
    });

    it('com contrato: devolve o walletId salvo', async () => {
      const { service } = build({ contract: { gatewayAccountRef: W } });
      await expect(service.getWallet('coach-1')).resolves.toEqual({ walletId: W, valid: true });
    });

    it('carteira salva antes da validação, fora do formato: devolve com valid false (a tela avisa)', async () => {
      const { service } = build({ contract: { gatewayAccountRef: '00000000-0000-0000-0000-000000000000' } });
      await expect(service.getWallet('coach-1')).resolves.toEqual({ walletId: '00000000-0000-0000-0000-000000000000', valid: false });
    });
  });

  describe('setWallet', () => {
    it('cadastra o walletId (upsert) com gateway ASAAS, sem tocar no platformFeePercent', async () => {
      const { service, prisma } = build();
      await expect(service.setWallet('coach-1', W)).resolves.toEqual({ walletId: W, valid: true });
      expect(prisma.coachContract.upsert).toHaveBeenCalledWith({
        where: { coachId: 'coach-1' },
        create: { coachId: 'coach-1', gatewayAccountRef: W, gateway: 'ASAAS' },
        update: { gatewayAccountRef: W, gateway: 'ASAAS' },
      });
    });
  });

  describe('getContractForCharge', () => {
    it('sem contrato: walletId null e platformFeePercent 0', async () => {
      await expect(build().service.getContractForCharge('coach-1')).resolves.toEqual({ walletId: null, platformFeePercent: 0 });
    });

    it('com contrato: devolve walletId e a % como número', async () => {
      const { service } = build({ contract: { gatewayAccountRef: W, platformFeePercent: '20.00' } });
      await expect(service.getContractForCharge('coach-1')).resolves.toEqual({ walletId: W, platformFeePercent: 20 });
    });

    it('carteira fora do formato conta como sem carteira (o checkout avisa o aluno em vez de o Asaas recusar)', async () => {
      const { service } = build({ contract: { gatewayAccountRef: '00000000-0000-0000-0000-000000000000', platformFeePercent: '20.00' } });
      await expect(service.getContractForCharge('coach-1')).resolves.toEqual({ walletId: null, platformFeePercent: 20 });
    });
  });
});
