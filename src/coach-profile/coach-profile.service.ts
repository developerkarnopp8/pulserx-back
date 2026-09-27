import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryService } from '../common/cloudinary.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../common/email.service';
import { escapeHtml } from '../common/escape-html';
import { UpdateCoachProfileDto, CreateLeadDto } from './dto/coach-profile.dto';

const PUBLIC_PLAN_SELECT = {
  id: true, name: true, description: true, priceCents: true, categories: true, isFree: true,
} as const;

@Injectable()
export class CoachProfileService {
  constructor(
    private prisma: PrismaService,
    private cloudinary: CloudinaryService,
    private notifications: NotificationsService,
    private email: EmailService,
  ) {}

  async getMine(coachId: string) {
    return this.prisma.coachProfile.findUnique({ where: { coachId } });
  }

  async upsert(coachId: string, dto: UpdateCoachProfileDto) {
    const existing = await this.prisma.coachProfile.findUnique({
      where: { slug: dto.slug },
      select: { coachId: true },
    });
    if (existing && existing.coachId !== coachId) {
      throw new ConflictException('Esse endereço já está em uso por outro coach — escolha outro.');
    }

    return this.prisma.coachProfile.upsert({
      where: { coachId },
      create: { coachId, slug: dto.slug, bio: dto.bio },
      update: { slug: dto.slug, bio: dto.bio },
    });
  }

  async setPublished(coachId: string, published: boolean) {
    const profile = await this.prisma.coachProfile.findUnique({ where: { coachId } });
    if (!profile) {
      throw new BadRequestException('Configure o endereço (slug) da sua página antes de publicar.');
    }
    return this.prisma.coachProfile.update({ where: { coachId }, data: { published } });
  }

  async uploadBanner(coachId: string, buffer: Buffer) {
    const profile = await this.prisma.coachProfile.findUnique({ where: { coachId } });
    if (!profile) {
      throw new BadRequestException('Configure o endereço (slug) da sua página antes de enviar o banner.');
    }
    const { url } = await this.cloudinary.uploadImage(buffer, `pulserx/coach-banners/${coachId}`);
    return this.prisma.coachProfile.update({ where: { coachId }, data: { bannerUrl: url } });
  }

  /** Página pública — só existe se published=true (sem revelar que existe despublicada). */
  async getPublicBySlug(slug: string) {
    const profile = await this.prisma.coachProfile.findUnique({
      where: { slug },
      select: {
        bio: true, bannerUrl: true,
        coach: { select: { id: true, name: true } },
        published: true,
      },
    });
    if (!profile || !profile.published) throw new NotFoundException('Página não encontrada');

    const plans = await this.prisma.subscriptionPlan.findMany({
      where: { coachId: profile.coach.id, active: true },
      select: PUBLIC_PLAN_SELECT,
      orderBy: { priceCents: 'asc' },
    });

    return {
      coachName: profile.coach.name,
      bio: profile.bio,
      bannerUrl: profile.bannerUrl,
      plans,
    };
  }

  async createLead(slug: string, dto: CreateLeadDto) {
    const profile = await this.prisma.coachProfile.findUnique({
      where: { slug },
      select: { published: true, coach: { select: { id: true, name: true, email: true } } },
    });
    if (!profile || !profile.published) throw new NotFoundException('Página não encontrada');

    const lead = await this.prisma.lead.create({
      data: { coachId: profile.coach.id, name: dto.name, email: dto.email, phone: dto.phone, message: dto.message },
    });

    await this.notifications.create(
      profile.coach.id,
      'new_lead',
      'Novo contato pela sua página!',
      `${dto.name} (${dto.email}) mandou uma mensagem pela sua landing page.`,
      '/coach/landing-page',
    );
    const safeName = escapeHtml(dto.name);
    const safeEmail = escapeHtml(dto.email);
    const safePhone = dto.phone ? escapeHtml(dto.phone) : undefined;
    const safeMessage = dto.message ? escapeHtml(dto.message) : undefined;
    await this.email.send(
      profile.coach.email,
      `Novo contato de ${safeName} — PulseRx`,
      `<p><strong>${safeName}</strong> (${safeEmail}${safePhone ? `, ${safePhone}` : ''}) entrou em contato pela sua página pública.</p>` +
      (safeMessage ? `<p>Mensagem: ${safeMessage}</p>` : ''),
    );

    return lead;
  }
}
