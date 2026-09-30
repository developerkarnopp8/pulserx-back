import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { TERMS_VERSION } from '../common/terms';
import { NotificationsService } from '../notifications/notifications.service';
import { PublicSignupDto } from './dto/public-signup.dto';

function emailExists() {
  return new ConflictException({
    statusCode: 409,
    code: 'EMAIL_EXISTS',
    message: 'Você já tem conta com este e-mail. Entre para continuar a assinatura.',
  });
}

@Injectable()
export class PublicSignupService {
  constructor(
    private prisma: PrismaService,
    private auth: AuthService,
    private notifications: NotificationsService,
  ) {}

  /**
   * Visitante da landing cria a própria conta de aluno, já vinculada ao coach DA PÁGINA, e sai
   * logado (o front segue direto pro pagamento do plano escolhido). Regras:
   * - página publicada (não publicada = 404, igual ao GET público — nunca diferencia os casos);
   * - plano do MESMO coach e ativo (senão 404) — o id do coach nunca vem do corpo;
   * - e-mail já usado (sem diferenciar maiúsculas) = 409 com `code: EMAIL_EXISTS`: o front pede
   *   pra entrar e continuar. Não cria nada nem altera a conta existente.
   */
  async signup(slug: string, dto: PublicSignupDto) {
    const profile = await this.prisma.coachProfile.findUnique({
      where: { slug },
      select: { coachId: true, published: true },
    });
    if (!profile?.published) throw new NotFoundException('Página não encontrada');

    const plan = await this.prisma.subscriptionPlan.findFirst({
      where: { id: dto.planId, coachId: profile.coachId, active: true },
      select: { id: true, name: true },
    });
    if (!plan) throw new NotFoundException('Plano não encontrado');

    const existing = await this.prisma.user.findFirst({
      where: { email: { equals: dto.email, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existing) throw emailExists();

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.$transaction(async tx => {
      const created = await tx.user.create({
        data: {
          name: dto.name,
          email: dto.email,
          passwordHash,
          role: 'athlete',
          termsAcceptedAt: new Date(),
          termsVersion: TERMS_VERSION,
          // Opcional e separado dos termos (LGPD Art. 11): sem marcar a caixa, é "não".
          healthConsent: dto.healthConsent === true,
          healthConsentAt: new Date(),
        },
        // termsVersion/healthConsent: o login diz ao front que não há nada pendente (senão a tela de consentimento abriria).
        select: { id: true, name: true, email: true, role: true, termsVersion: true, healthConsent: true },
      });
      await tx.student.create({ data: { userId: created.id, coachId: profile.coachId } });
      return created;
    }).catch(err => {
      // Duas inscrições simultâneas com o mesmo e-mail: a segunda bate no unique do banco.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw emailExists();
      throw err;
    });

    // Aviso pro coach não pode derrubar a inscrição já feita.
    await this.notifications
      .create(profile.coachId, 'new_student', 'Novo aluno pela sua página', `${user.name} se inscreveu no plano ${plan.name}.`, '/coach/students')
      .catch(() => undefined);

    return { ...(await this.auth.login(user)), planId: plan.id };
  }
}
