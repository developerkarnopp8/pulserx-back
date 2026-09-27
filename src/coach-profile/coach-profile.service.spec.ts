import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CoachProfileService } from './coach-profile.service';

function build() {
  const prisma: any = {
    coachProfile: { findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn() },
    subscriptionPlan: { findMany: jest.fn() },
    lead: { create: jest.fn() },
  };
  const cloudinary = { uploadImage: jest.fn() };
  const notifications = { create: jest.fn() };
  const email = { send: jest.fn() };
  const service = new CoachProfileService(prisma, cloudinary as any, notifications as any, email as any);
  return { service, prisma, cloudinary, notifications, email };
}

describe('CoachProfileService.getMine', () => {
  it('devolve o perfil do coach (ou null se não existir)', async () => {
    const { service, prisma } = build();
    prisma.coachProfile.findUnique.mockResolvedValue({ id: 'p1', coachId: 'coach-1' });
    await expect(service.getMine('coach-1')).resolves.toEqual({ id: 'p1', coachId: 'coach-1' });
    expect(prisma.coachProfile.findUnique).toHaveBeenCalledWith({ where: { coachId: 'coach-1' } });
  });
});

describe('CoachProfileService.upsert', () => {
  it('cria o perfil quando o slug está livre', async () => {
    const { service, prisma } = build();
    prisma.coachProfile.findUnique.mockResolvedValue(null);
    prisma.coachProfile.upsert.mockResolvedValue({ id: 'p1', coachId: 'coach-1', slug: 'luan' });

    await service.upsert('coach-1', { slug: 'luan', bio: 'Treinador' });

    expect(prisma.coachProfile.upsert).toHaveBeenCalledWith({
      where: { coachId: 'coach-1' },
      create: { coachId: 'coach-1', slug: 'luan', bio: 'Treinador' },
      update: { slug: 'luan', bio: 'Treinador' },
    });
  });

  it('slug já usado pelo PRÓPRIO coach: deixa passar (é edição, não conflito)', async () => {
    const { service, prisma } = build();
    prisma.coachProfile.findUnique.mockResolvedValue({ coachId: 'coach-1' });
    prisma.coachProfile.upsert.mockResolvedValue({ id: 'p1' });

    await expect(service.upsert('coach-1', { slug: 'luan' })).resolves.toBeDefined();
  });

  it('slug já usado por OUTRO coach: 409, sem tentar upsert', async () => {
    const { service, prisma } = build();
    prisma.coachProfile.findUnique.mockResolvedValue({ coachId: 'coach-9' });

    await expect(service.upsert('coach-1', { slug: 'luan' })).rejects.toThrow(ConflictException);
    expect(prisma.coachProfile.upsert).not.toHaveBeenCalled();
  });
});

describe('CoachProfileService.setPublished', () => {
  it('sem perfil configurado: 400, não tenta atualizar', async () => {
    const { service, prisma } = build();
    prisma.coachProfile.findUnique.mockResolvedValue(null);

    await expect(service.setPublished('coach-1', true)).rejects.toThrow(BadRequestException);
    expect(prisma.coachProfile.update).not.toHaveBeenCalled();
  });

  it('com perfil: liga/desliga published', async () => {
    const { service, prisma } = build();
    prisma.coachProfile.findUnique.mockResolvedValue({ id: 'p1' });
    prisma.coachProfile.update.mockResolvedValue({ id: 'p1', published: true });

    await expect(service.setPublished('coach-1', true)).resolves.toEqual({ id: 'p1', published: true });
    expect(prisma.coachProfile.update).toHaveBeenCalledWith({ where: { coachId: 'coach-1' }, data: { published: true } });
  });
});

describe('CoachProfileService.uploadBanner', () => {
  it('sem perfil configurado: 400, não sobe nada pro Cloudinary', async () => {
    const { service, prisma, cloudinary } = build();
    prisma.coachProfile.findUnique.mockResolvedValue(null);

    await expect(service.uploadBanner('coach-1', Buffer.from('img'))).rejects.toThrow(BadRequestException);
    expect(cloudinary.uploadImage).not.toHaveBeenCalled();
  });

  it('com perfil: sobe a imagem na pasta do coach e salva a url', async () => {
    const { service, prisma, cloudinary } = build();
    prisma.coachProfile.findUnique.mockResolvedValue({ id: 'p1' });
    cloudinary.uploadImage.mockResolvedValue({ url: 'https://res.cloudinary.com/banner.jpg' });
    prisma.coachProfile.update.mockResolvedValue({ id: 'p1', bannerUrl: 'https://res.cloudinary.com/banner.jpg' });

    const result = await service.uploadBanner('coach-1', Buffer.from('img'));

    expect(cloudinary.uploadImage).toHaveBeenCalledWith(Buffer.from('img'), 'pulserx/coach-banners/coach-1');
    expect(prisma.coachProfile.update).toHaveBeenCalledWith({
      where: { coachId: 'coach-1' }, data: { bannerUrl: 'https://res.cloudinary.com/banner.jpg' },
    });
    expect(result.bannerUrl).toBe('https://res.cloudinary.com/banner.jpg');
  });
});

describe('CoachProfileService.getPublicBySlug', () => {
  it('slug inexistente: 404', async () => {
    const { service, prisma } = build();
    prisma.coachProfile.findUnique.mockResolvedValue(null);

    await expect(service.getPublicBySlug('nao-existe')).rejects.toThrow(NotFoundException);
  });

  it('perfil existe mas não está publicado: 404 (não revela que existe)', async () => {
    const { service, prisma } = build();
    prisma.coachProfile.findUnique.mockResolvedValue({ published: false, coach: { id: 'coach-1', name: 'Luan' } });

    await expect(service.getPublicBySlug('luan')).rejects.toThrow(NotFoundException);
  });

  it('publicado: devolve nome/bio/banner + só os planos ativos do coach, sem campos sensíveis', async () => {
    const { service, prisma } = build();
    prisma.coachProfile.findUnique.mockResolvedValue({
      bio: 'Treinador', bannerUrl: 'https://x/banner.jpg', published: true,
      coach: { id: 'coach-1', name: 'Luan' },
    });
    prisma.subscriptionPlan.findMany.mockResolvedValue([
      { id: 'plan1', name: 'Core', description: null, priceCents: 9900, categories: ['CORE'], isFree: false },
    ]);

    const result = await service.getPublicBySlug('luan');

    expect(prisma.subscriptionPlan.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { coachId: 'coach-1', active: true },
    }));
    expect(result).toEqual({
      coachName: 'Luan', bio: 'Treinador', bannerUrl: 'https://x/banner.jpg',
      plans: [{ id: 'plan1', name: 'Core', description: null, priceCents: 9900, categories: ['CORE'], isFree: false }],
    });
  });
});

describe('CoachProfileService.createLead', () => {
  const publishedProfile = {
    published: true,
    coach: { id: 'coach-1', name: 'Luan', email: 'luan@aevonfit.com' },
  };

  it('slug inexistente: 404, sem criar lead', async () => {
    const { service, prisma } = build();
    prisma.coachProfile.findUnique.mockResolvedValue(null);

    await expect(service.createLead('nao-existe', { name: 'Ana', email: 'ana@x.com' })).rejects.toThrow(NotFoundException);
    expect(prisma.lead.create).not.toHaveBeenCalled();
  });

  it('não publicado: 404, sem criar lead', async () => {
    const { service, prisma } = build();
    prisma.coachProfile.findUnique.mockResolvedValue({ ...publishedProfile, published: false });

    await expect(service.createLead('luan', { name: 'Ana', email: 'ana@x.com' })).rejects.toThrow(NotFoundException);
    expect(prisma.lead.create).not.toHaveBeenCalled();
  });

  it('cria o lead, notifica o coach in-app e por e-mail', async () => {
    const { service, prisma, notifications, email } = build();
    prisma.coachProfile.findUnique.mockResolvedValue(publishedProfile);
    prisma.lead.create.mockResolvedValue({ id: 'lead1', coachId: 'coach-1', name: 'Ana', email: 'ana@x.com' });

    const result = await service.createLead('luan', { name: 'Ana', email: 'ana@x.com', phone: '11999999999', message: 'Quero treinar' });

    expect(prisma.lead.create).toHaveBeenCalledWith({
      data: { coachId: 'coach-1', name: 'Ana', email: 'ana@x.com', phone: '11999999999', message: 'Quero treinar' },
    });
    expect(notifications.create).toHaveBeenCalledWith(
      'coach-1', 'new_lead', 'Novo contato pela sua página!',
      expect.stringContaining('Ana'), '/coach/landing-page',
    );
    expect(email.send).toHaveBeenCalledWith(
      'luan@aevonfit.com',
      expect.stringContaining('Ana'),
      expect.stringContaining('Ana'),
    );
    expect(result.id).toBe('lead1');
  });

  it('escapa HTML do nome/mensagem antes de montar o e-mail (XSS)', async () => {
    const { service, prisma, email } = build();
    prisma.coachProfile.findUnique.mockResolvedValue(publishedProfile);
    prisma.lead.create.mockResolvedValue({ id: 'lead1' });

    await service.createLead('luan', {
      name: '<script>alert(1)</script>', email: 'ana@x.com', message: '<img src=x onerror=alert(1)>',
    });

    const html = email.send.mock.calls[0][2];
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
  });

  it('sem phone/message: não quebra e não aparecem no e-mail', async () => {
    const { service, prisma, email } = build();
    prisma.coachProfile.findUnique.mockResolvedValue(publishedProfile);
    prisma.lead.create.mockResolvedValue({ id: 'lead1' });

    await service.createLead('luan', { name: 'Ana', email: 'ana@x.com' });

    expect(prisma.lead.create).toHaveBeenCalledWith({
      data: { coachId: 'coach-1', name: 'Ana', email: 'ana@x.com', phone: undefined, message: undefined },
    });
    const html = email.send.mock.calls[0][2];
    expect(html).not.toContain('Mensagem:');
  });
});
